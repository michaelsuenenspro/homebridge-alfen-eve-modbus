'use strict';

const net = require('net');
const Modbus = require('jsmodbus');

// Register map from the Alfen "Modbus for ACE" configuration guide (v1.0, EN 05/2025).
const REG = {
  AVAILABILITY: 1200, // u16, 1 = operative
  APPLIED_MAX: 1206, // f32, actual applied max current (A)
  VALID_TIME: 1208, // u32, seconds before the charger falls back to its safe current
  SETPOINT: 1210, // f32 R/W, Modbus server max current (A)
};

function encodeFloat32(value) {
  const buf = Buffer.alloc(4);
  buf.writeFloatBE(value, 0);
  return [buf.readUInt16BE(0), buf.readUInt16BE(2)];
}

function decodeFloat32(words) {
  const buf = Buffer.alloc(4);
  buf.writeUInt16BE(words[0], 0);
  buf.writeUInt16BE(words[1], 2);
  return buf.readFloatBE(0);
}

class AlfenModbusClient {
  constructor({ host, port = 502, unitId = 1, timeoutMs = 3000, log }) {
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.socket = null;
    this.connection = null; // Promise of the Modbus client, shared by concurrent callers.
  }

  connect() {
    if (!this.connection) {
      this.connection = this.open().catch((err) => {
        this.connection = null;
        throw err;
      });
    }
    return this.connection;
  }

  async open() {
    const socket = new net.Socket();
    // jsmodbus only marks itself online for a 'connect' event it has already seen, so it must be created first.
    const client = new Modbus.client.TCP(socket, this.unitId, this.timeoutMs);

    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(this.port, this.host, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });

    socket.on('error', (err) => this.log.warn(`Modbus socket error: ${err.message}`));
    socket.on('close', () => {
      if (this.socket === socket) {
        this.socket = null;
        this.connection = null;
      }
    });

    this.socket = socket;
    return client;
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
    }
    this.socket = null;
    this.connection = null;
  }

  // Any failure drops the connection so the next call reconnects.
  async run(action) {
    try {
      const client = await this.connect();
      return await action(client);
    } catch (err) {
      this.disconnect();
      throw err;
    }
  }

  async readFloat32(address) {
    const res = await this.run((client) => client.readHoldingRegisters(address, 2));
    return decodeFloat32(res.response.body.valuesAsArray);
  }

  async readUInt16(address) {
    const res = await this.run((client) => client.readHoldingRegisters(address, 1));
    return res.response.body.valuesAsArray[0];
  }

  async readUInt32(address) {
    const res = await this.run((client) => client.readHoldingRegisters(address, 2));
    const [high, low] = res.response.body.valuesAsArray;
    return high * 0x10000 + low;
  }

  async writeFloat32(address, value) {
    await this.run((client) => client.writeMultipleRegisters(address, encodeFloat32(value)));
  }
}

module.exports = { AlfenModbusClient, REG, encodeFloat32, decodeFloat32 };
