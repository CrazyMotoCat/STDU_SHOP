import { createApiApp } from './app.factory.js';

createApiApp()
  .then((app) => {
    const port = Number(process.env.PORT ?? '3001');
    const host = process.env.HOST ?? '127.0.0.1';
    return app.listen(port, host);
  })
  .catch(() => {
    console.error('API startup failed; check the required environment keys.');
    process.exitCode = 1;
  });
