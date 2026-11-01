'use strict';

const fs = require('fs');
const path = require('path');
const { AlfenModbusClient, REG } = require('./lib/alfen-modbus');

const PLUGIN_NAME = 'homebridge-alfen-eve-modbus';
const PLATFORM_NAME = 'AlfenEveModbus';
const DEFAULT_NAME = 'Alfen Eve charger';

// The charger falls back to its safe current (0 A) when no setpoint arrives within the
// validity time (60 s by default). We refresh well inside that window.
const DEFAULT_REFRESH_S = 20;

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, AlfenEvePlatform);
};

class AlfenEvePlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.cachedAccessories = [];
    this.accessory = null;
    this.timer = null;
    this.lastError = null;

    this.name = this.config.name || DEFAULT_NAME;
    this.maxCurrentA = Number(this.config.max_current_a) || 16;
    this.refreshMs = (Number(this.config.refresh_s) || DEFAULT_REFRESH_S) * 1000;
    this.stateFile = path.join(api.user.storagePath(), 'alfen-eve-modbus.json');
    this.enabled = this.loadState();

    this.charger = new AlfenModbusClient({
      host: this.config.host,
      port: this.config.port || 502,
      unitId: this.config.unit_id || 1,
      log,
    });

    api.on('didFinishLaunching', () => this.start());
    api.on('shutdown', () => this.stop());
  }

  // Homebridge calls this for accessories restored from its cache, before didFinishLaunching.
  configureAccessory(accessory) {
    this.cachedAccessories.push(accessory);
  }

  start() {
    if (!this.config.host) {
      this.log.error('No "host" configured for the Alfen charger; the switch is not created.');
      return;
    }

    const { Service, Characteristic, Categories } = this.api.hap;
    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${this.config.host}`);

    this.accessory = this.cachedAccessories.find((a) => a.UUID === uuid);
    if (!this.accessory) {
      this.accessory = new this.api.platformAccessory(this.name, uuid, Categories.SWITCH);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [this.accessory]);
    }

    this.service = this.accessory.getService(Service.Switch)
      || this.accessory.addService(Service.Switch, this.name);

    this.service.getCharacteristic(Characteristic.On)
      .onGet(() => this.enabled)
      .onSet((value) => this.setEnabled(value));

    this.log.info(`Charging is ${this.enabled ? 'allowed' : 'blocked'} at startup; applying to ${this.config.host}.`);
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.refreshMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.charger.disconnect();
  }

  async setEnabled(value) {
    this.enabled = Boolean(value);
    this.saveState();
    this.log.info(`Charging ${this.enabled ? 'allowed' : 'blocked'} by HomeKit switch.`);

    try {
      await this.writeSetpoint();
    } catch (err) {
      // The state is stored, so the periodic refresh keeps retrying.
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async refresh() {
    try {
      await this.writeSetpoint();
    } catch (err) {
      this.logOnce(`Cannot reach the Alfen charger at ${this.config.host}: ${err.message}`);
    }
  }

  async writeSetpoint() {
    const target = this.enabled ? this.maxCurrentA : 0;
    await this.charger.writeFloat32(REG.SETPOINT, target);
    this.lastError = null;
  }

  logOnce(message) {
    if (message !== this.lastError) {
      this.log.error(message);
      this.lastError = message;
    }
  }

  loadState() {
    try {
      return Boolean(JSON.parse(fs.readFileSync(this.stateFile, 'utf8')).enabled);
    } catch (err) {
      return false; // Blocked until the user switches it on.
    }
  }

  saveState() {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify({ enabled: this.enabled }));
    } catch (err) {
      this.log.warn(`Could not persist switch state: ${err.message}`);
    }
  }
}
