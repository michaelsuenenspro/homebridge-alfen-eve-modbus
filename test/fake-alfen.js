'use strict';

// Minimal Modbus TCP slave that behaves like the Alfen for FC 0x03 and 0x10.
// Used only by the tests.

const net = require('net');

function startFakeAlfen() {
  const registers = new Map();
  const writes = [];

  const handle = (frame) => {
    const transactionId = frame.readUInt16BE(0);
    const unitId = frame[6];
    const fc = frame[7];
    let pdu;

    if (fc === 0x03) {
      const address = frame.readUInt16BE(8);
      const quantity = frame.readUInt16BE(10);
      const body = Buffer.alloc(quantity * 2);
      for (let i = 0; i < quantity; i++) {
        body.writeUInt16BE(registers.get(address + i) ?? 0, i * 2);
      }
      pdu = Buffer.concat([Buffer.from([0x03, quantity * 2]), body]);
    } else if (fc === 0x10) {
      const address = frame.readUInt16BE(8);
      const quantity = frame.readUInt16BE(10);
      for (let i = 0; i < quantity; i++) {
        registers.set(address + i, frame.readUInt16BE(13 + i * 2));
      }
      writes.push({ address, quantity });
      pdu = Buffer.from([0x10, frame[8], frame[9], frame[10], frame[11]]);
    } else {
      pdu = Buffer.from([fc | 0x80, 0x01]);
    }

    const header = Buffer.alloc(7);
    header.writeUInt16BE(transactionId, 0);
    header.writeUInt16BE(pdu.length + 1, 4);
    header[6] = unitId;
    return Buffer.concat([header, pdu]);
  };

  const sockets = new Set();
  const server = net.createServer((socket) => {
    let pending = Buffer.alloc(0);
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 7 && pending.length >= 6 + pending.readUInt16BE(4)) {
        const length = 6 + pending.readUInt16BE(4);
        const frame = pending.subarray(0, length);
        pending = pending.subarray(length);
        socket.write(handle(frame));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        registers,
        writes,
        close: () => new Promise((done) => {
          sockets.forEach((socket) => socket.destroy());
          server.close(() => done());
        }),
      });
    });
  });
}

module.exports = { startFakeAlfen };
