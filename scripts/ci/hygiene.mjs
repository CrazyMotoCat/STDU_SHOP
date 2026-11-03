import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function checkAddedLines(patch) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    if (patterns.some((pattern) => pattern.test(line)))
      throw new Error('Possible credential in added lines; value suppressed');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.env.CI_DIFF_BASE;
  if (!/^[a-f0-9]{40}$/.test(base ?? ''))
    throw new Error('valid diff base required');
  const git = (...args) =>
    execFileSync('git', args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  git('diff', '--check', base, 'HEAD');
  checkAddedLines(git('diff', '--no-ext-diff', '--unified=0', base, 'HEAD'));
  const names = git(
    'diff',
    '--name-only',
    '--diff-filter=A',
    base,
    'HEAD',
  ).split('\n');
  if (
    names.some(
      (path) => /(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.example'),
    )
  )
    throw new Error('Unexpected environment file added');
  console.log(
    'PASS diff hygiene and limited credential-pattern scan (not a full secret scanner)',
  );
}
