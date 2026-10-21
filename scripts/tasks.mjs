import { run, toolchain, reportFailure } from './lib.mjs';

const py = ['run', '--project', 'services/ingestion', '--locked'];
const action = process.argv[2];

async function main() {
  switch (action) {
    case 'toolchain': {
      const versions = {
        node: process.versions.node,
        pnpm: await run('pnpm', ['--version'], { capture: true }),
        uv: (await run('uv', ['--version'], { capture: true })).split(' ')[1],
        python: (
          await run('uv', [...py, 'python', '--version'], { capture: true })
        ).split(' ')[1],
      };
      for (const [name, expected] of Object.entries(toolchain)) {
        if (versions[name] !== expected)
          throw new Error(
            `${name} must be ${expected}; found ${versions[name]}.`,
          );
        console.log(`PASS ${name} ${expected}`);
      }
      break;
    }
    case 'lint':
      await run('pnpm', ['exec', 'eslint', '.', '--max-warnings', '0']);
      await run('uv', [
        ...py,
        'ruff',
        'check',
        'services/ingestion',
        'scripts/windows_job.py',
      ]);
      break;
    case 'format-check':
    case 'format':
      await run('pnpm', [
        'exec',
        'prettier',
        action === 'format' ? '--write' : '--check',
        '.',
      ]);
      await run('uv', [
        ...py,
        'ruff',
        'format',
        ...(action === 'format' ? [] : ['--check']),
        'services/ingestion',
        'scripts/windows_job.py',
      ]);
      break;
    case 'typecheck':
      await run('pnpm', ['-r', 'typecheck']);
      await run('uv', [
        ...py,
        'mypy',
        '--config-file',
        'services/ingestion/pyproject.toml',
        'services/ingestion/src',
        'services/ingestion/tests',
      ]);
      await run('uv', [
        ...py,
        'mypy',
        '--platform',
        'win32',
        '--check-untyped-defs',
        'scripts/windows_job.py',
      ]);
      break;
    case 'test':
      await run('pnpm', ['exec', 'vitest', 'run']);
      await run('uv', [...py, 'pytest', 'services/ingestion/tests']);
      break;
    case 'build':
      await run('pnpm', ['-r', 'build']);
      await run('uv', ['build', '--project', 'services/ingestion']);
      break;
    default:
      throw new Error(`Unknown task: ${action}`);
  }
}

main().catch(reportFailure);
