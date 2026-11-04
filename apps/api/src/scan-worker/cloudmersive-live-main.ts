import { scanLiveSynthetic } from './cloudmersive-live.js';

void scanLiveSynthetic(process.argv[2] ?? '')
  .then((outcome) => {
    process.stdout.write(outcome + '\n');
    if (outcome !== 'CLEAN_VERIFIED') process.exitCode = 1;
  })
  .catch(() => {
    process.stderr.write(
      'SEC-API-03 refused or failed. Check the local runbook and campaign state.\n',
    );
    process.exitCode = 1;
  });
