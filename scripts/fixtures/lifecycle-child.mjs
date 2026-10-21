import { appendFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

const [record, mode = 'normal', port = '0'] = process.argv.slice(2);
const server = createServer();
let child;
server.listen(Number(port), '127.0.0.1', () => {
  appendFileSync(
    record,
    JSON.stringify({ pid: process.pid, port: server.address().port }) + '\n',
  );
  if (mode === 'tree' || mode === 'early-exit') {
    child = spawn(
      process.execPath,
      [import.meta.filename, record, 'normal', String(Number(port) + 1)],
      {
        stdio: 'inherit',
      },
    );
    if (mode === 'early-exit') setTimeout(() => process.exit(3), 350);
  }
});
process.on('SIGTERM', () => {
  if (mode === 'stubborn') return;
  server.close();
  if (child) child.once('exit', () => process.exit(0));
  else process.exit(0);
});
