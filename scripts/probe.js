'use strict';

// Reads the status registers of the Alfen so you can check the connection before Homebridge is involved.
// Usage: node scripts/probe.js <ip-address> [port] [unit-id]

const { AlfenModbusClient, REG } = require('../lib/alfen-modbus');

async function main() {
  const [host, port = 502, unitId = 1] = process.argv.slice(2);
  if (!host) {
    console.error('Usage: node scripts/probe.js <ip-address> [port] [unit-id]');
    process.exit(1);
  }

  const client = new AlfenModbusClient({
    host,
    port: Number(port),
    unitId: Number(unitId),
    log: { warn: console.warn },
  });

  try {
    const availability = await client.readUInt16(REG.AVAILABILITY);
    const validTime = await client.readUInt32(REG.VALID_TIME);
    const applied = await client.readFloat32(REG.APPLIED_MAX);
    const setpoint = await client.readFloat32(REG.SETPOINT);

    console.log(`Availability (1200):        ${availability} (1 = operative)`);
    console.log(`Valid time (1208):          ${validTime} s (remaining, 0 = no EMS writes)`);
    console.log(`Actual applied max (1206):  ${applied.toFixed(1)} A`);
    console.log(`Modbus setpoint (1210):     ${setpoint.toFixed(1)} A`);
  } catch (err) {
    console.error(`Failed to read from ${host}:${port}: ${err.message}`);
    process.exitCode = 2;
  } finally {
    client.disconnect();
  }
}

main();
