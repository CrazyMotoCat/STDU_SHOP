import { runStaffAccessCli } from '../src/cli/staff-access.js';

const [mode, ...args] = process.argv.slice(2);
try {
  if (!mode) throw new Error('A command is required: bootstrap or recover.');
  await runStaffAccessCli(mode, args);
} catch (error) {
  const message =
    error instanceof Error ? error.message : 'Staff access command failed.';
  console.error(message);
  process.exitCode = 1;
}
