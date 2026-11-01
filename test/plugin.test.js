'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startFakeAlfen } = require('./fake-alfen');
const { AlfenModbusClient, REG, decodeFloat32 } = require('../lib/alfen-modbus');
const registerPlugin = require('../index');

const silentLog = { info() {}, warn() {}, error() {}, debug() {} };

function waitFor(condition, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (condition()) {
        return resolve();
      }
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('condition not met in time'));
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

// Just enough of the Homebridge API for the platform to run.
function fakeHomebridge(storagePath) {
  const listeners = {};
  const registered = { platform: null, accessories: [] };

  class HapStatusError extends Error {
    constructor(code) {
      super(`HAP status ${code}`);
      this.code = code;
    }
  }

  class Characteristic {
    onGet(fn) { this.get = fn; return this; }
    onSet(fn) { this.set = fn; return this; }
  }

  class Service {
    constructor(type, name) { this.type = type; this.name = name; this.characteristics = new Map(); }
    getCharacteristic(name) {
      if (!this.characteristics.has(name)) this.characteristics.set(name, new Characteristic());
      return this.characteristics.get(name);
    }
  }

  class PlatformAccessory {
    constructor(name, uuid) { this.displayName = name; this.UUID = uuid; this.services = []; }
    getService(type) { return this.services.find((s) => s.type === type); }
    addService(type, name) { const s = new Service(type, name); this.services.push(s); return s; }
  }

  const api = {
    hap: {
      uuid: { generate: (seed) => `uuid:${seed}` },
      Categories: { SWITCH: 8 },
      Service: { Switch: 'Switch' },
      Characteristic: { On: 'On' },
      HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
      HapStatusError,
    },
    user: { storagePath: () => storagePath },
    platformAccessory: PlatformAccessory,
    registerPlatformAccessories: (plugin, platform, accessories) => registered.accessories.push(...accessories),
    on: (event, fn) => { (listeners[event] = listeners[event] || []).push(fn); },
    emit: (event) => (listeners[event] || []).forEach((fn) => fn()),
    registerPlatform: (name, Platform) => { registered.platform = { name, Platform }; },
  };

  registerPlugin(api);
  return { api, registered, HapStatusError };
}

function makeStorage() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alfen-eve-test-'));
}

test('float32 setpoint is written big-endian and read back', async () => {
  const alfen = await startFakeAlfen();
  const client = new AlfenModbusClient({ host: '127.0.0.1', port: alfen.port, log: silentLog });

  await client.writeFloat32(REG.SETPOINT, 16);
  assert.equal(alfen.registers.get(REG.SETPOINT), 0x4180);
  assert.equal(alfen.registers.get(REG.SETPOINT + 1), 0x0000);
  assert.equal(await client.readFloat32(REG.SETPOINT), 16);

  await client.writeFloat32(REG.SETPOINT, 0);
  assert.equal(decodeFloat32([alfen.registers.get(REG.SETPOINT), alfen.registers.get(REG.SETPOINT + 1)]), 0);

  client.disconnect();
  await alfen.close();
});

test('switch on writes the max current, switch off writes 0 A', async () => {
  const alfen = await startFakeAlfen();
  const homebridge = fakeHomebridge(makeStorage());
  const config = { host: '127.0.0.1', port: alfen.port, max_current_a: 16, refresh_s: 5 };
  const platform = new homebridge.registered.platform.Platform(silentLog, config, homebridge.api);
  homebridge.api.emit('didFinishLaunching');

  await waitFor(() => alfen.writes.length >= 1);
  assert.equal(decodeFloat32([alfen.registers.get(REG.SETPOINT), alfen.registers.get(REG.SETPOINT + 1)]), 0,
    'blocked by default');

  const onCharacteristic = homebridge.registered.accessories[0].getService('Switch').getCharacteristic('On');
  assert.equal(onCharacteristic.get(), false);

  await onCharacteristic.set(true);
  assert.equal(decodeFloat32([alfen.registers.get(REG.SETPOINT), alfen.registers.get(REG.SETPOINT + 1)]), 16);

  await onCharacteristic.set(false);
  assert.equal(decodeFloat32([alfen.registers.get(REG.SETPOINT), alfen.registers.get(REG.SETPOINT + 1)]), 0);

  platform.stop();
  await alfen.close();
});

test('state survives a Homebridge restart', async () => {
  const alfen = await startFakeAlfen();
  const storage = makeStorage();
  const config = { host: '127.0.0.1', port: alfen.port, max_current_a: 10, refresh_s: 5 };

  const first = fakeHomebridge(storage);
  const firstPlatform = new first.registered.platform.Platform(silentLog, config, first.api);
  first.api.emit('didFinishLaunching');
  await waitFor(() => alfen.writes.length >= 1);
  await first.registered.accessories[0].getService('Switch').getCharacteristic('On').set(true);
  firstPlatform.stop();

  const second = fakeHomebridge(storage);
  const secondPlatform = new second.registered.platform.Platform(silentLog, config, second.api);
  second.api.emit('didFinishLaunching');
  await waitFor(() => alfen.writes.length >= 3);

  assert.equal(second.registered.accessories[0].getService('Switch').getCharacteristic('On').get(), true);
  assert.equal(decodeFloat32([alfen.registers.get(REG.SETPOINT), alfen.registers.get(REG.SETPOINT + 1)]), 10);

  secondPlatform.stop();
  await alfen.close();
});

test('unreachable charger makes the HomeKit set fail, state is kept for retry', async () => {
  const alfen = await startFakeAlfen();
  const port = alfen.port;
  await alfen.close();

  const homebridge = fakeHomebridge(makeStorage());
  const config = { host: '127.0.0.1', port, max_current_a: 16, refresh_s: 5 };
  const platform = new homebridge.registered.platform.Platform(silentLog, config, homebridge.api);
  homebridge.api.emit('didFinishLaunching');

  const onCharacteristic = homebridge.registered.accessories[0].getService('Switch').getCharacteristic('On');
  await assert.rejects(onCharacteristic.set(true), (err) => err.code === -70402);
  assert.equal(onCharacteristic.get(), true, 'state is kept so the refresh loop can retry');

  platform.stop();
});
