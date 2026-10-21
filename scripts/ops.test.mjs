import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compose, requireFreePort, runningServices } from './lib.mjs';
import { composeUp } from './ops.mjs';

vi.mock('./lib.mjs', () => ({
  compose: vi.fn(),
  loadLocalEnv: vi.fn(),
  requireFreePort: vi.fn(),
  requireLocalDocker: vi.fn(),
  runningServices: vi.fn(),
  reportFailure: vi.fn(),
}));
vi.mock('./host-apps.mjs', () => ({ withHostApps: vi.fn() }));

beforeEach(() => vi.resetAllMocks());

describe('full Compose ports', () => {
  it('checks only the two ports published on the host', async () => {
    vi.mocked(runningServices).mockResolvedValue([]);
    await composeUp();
    expect(requireFreePort.mock.calls).toEqual([[3000], [3001]]);
    expect(compose).toHaveBeenCalledExactlyOnceWith([
      'up',
      '-d',
      '--build',
      '--wait',
      '--wait-timeout',
      '180',
    ]);
  });

  it('does not reject ports owned by the already running Compose apps', async () => {
    vi.mocked(runningServices).mockResolvedValue(['web', 'api']);
    await composeUp();
    expect(requireFreePort).not.toHaveBeenCalled();
    expect(compose).toHaveBeenCalledOnce();
  });
});
