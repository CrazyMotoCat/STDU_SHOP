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
const faultMode = process.env.R1_010D_FAKE_PROBE_FAIL_AFTER_SCAN ?? 'false';
const failAfterScan = faultMode !== 'false';
let resourceUnavailable = faultMode === 'before';

function versionReply() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `ClamAV 1.4.6/29900/${weekdays[now.getUTCDay()]} ${months[now.getUTCMonth()]} ${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} ${now.getUTCFullYear()}`;
}
const stableVersion = versionReply();

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
        socket.write(`${nextId}: ${stableVersion}\0`);
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
const restartedInstance = `${randomUUID()}:2:2`;
createHttpServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/ready') {
    response.writeHead(404).end();
    return;
  }
  if (
    resourceUnavailable &&
    [
      'unavailable',
      'before',
      'statfs',
      'config',
      'cgroupmissing',
      'cgroupmalformed',
    ].includes(faultMode)
  ) {
    response.writeHead(503).end();
    return;
  }
  if (resourceUnavailable && faultMode === 'timeout') return;
  if (resourceUnavailable && faultMode === 'malformed') {
    response.writeHead(200).end('{invalid');
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      ready: true,
      instance:
        resourceUnavailable && faultMode === 'instance'
          ? restartedInstance
          : instance,
      measuredAt:
        Date.now() - (resourceUnavailable && faultMode === 'stale' ? 6000 : 0),
      scratchAvailableBytes:
        resourceUnavailable && faultMode === 'scratch' ? 0 : 512 * 1024 * 1024,
      oom: resourceUnavailable && faultMode === 'oom' ? 1 : 0,
      oomKill: 0,
    }),
  );
}).listen(3311, '0.0.0.0');
