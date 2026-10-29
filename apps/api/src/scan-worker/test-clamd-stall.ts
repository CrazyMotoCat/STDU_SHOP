import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const failAfterScan = process.env.R1_010D_FAKE_PROBE_FAIL_AFTER_SCAN === 'true';
let resourceUnavailable = false;

function versionReply() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `ClamAV 1.4.6/29900/${weekdays[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} ${now.getUTCFullYear()}`;
}

const server = createServer((socket) => {
  let buffer = Buffer.alloc(0);
  let nextId = 0;
  let streaming = false;
  let scanId = 0;
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (streaming) {
        if (buffer.length < 4) return;
        const size = buffer.readUInt32BE(0);
        if (buffer.length < 4 + size) return;
        buffer = buffer.subarray(4 + size);
        if (size === 0) {
          streaming = false;
          process.stdout.write('R1_010D_FAKE_CLAMD_INSTREAM\n');
          if (failAfterScan) {
            resourceUnavailable = true;
            socket.write(`${scanId}: stream: OK\0`);
          }
        }
        continue;
      }
      const end = buffer.indexOf(0);
      if (end < 0) return;
      const command = buffer.subarray(0, end).toString('utf8');
      buffer = buffer.subarray(end + 1);
      if (command === 'zIDSESSION') continue;
      if (command === 'zPING') {
        nextId++;
        socket.write(`${nextId}: PONG\0`);
      } else if (command === 'zVERSION') {
        nextId++;
        socket.write(`${nextId}: ${versionReply()}\0`);
      } else if (command === 'zINSTREAM') {
        nextId++;
        scanId = nextId;
        streaming = true;
      } else if (command === 'zEND') {
        socket.end();
        return;
      }
    }
  });
});

server.listen(3310, '0.0.0.0');

const instance = `${randomUUID()}:1:1`;
createHttpServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/ready') {
    response.writeHead(404).end();
    return;
  }
  if (resourceUnavailable) {
    response.writeHead(503).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      ready: true,
      instance,
      measuredAt: Date.now(),
      scratchAvailableBytes: 512 * 1024 * 1024,
      oom: 0,
      oomKill: 0,
    }),
  );
}).listen(3311, '0.0.0.0');
