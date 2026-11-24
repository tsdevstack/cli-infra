import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { warnMissingCronHandlers } from './warn-missing-cron-handlers';

const cron = {
  name: 'usage-report',
  type: 'cron' as const,
  schedule: '0 3 * * *',
  targetService: 'auth-service',
};
const trigger = {
  name: 'cleanup-tokens',
  schedule: '0 */4 * * *',
  targetService: 'auth-service',
  endpoint: '/auth/jobs/cleanup-tokens',
};

describe('warnMissingCronHandlers', () => {
  let root: string;

  const write = (file: string): void => {
    const full = path.join(root, 'apps/auth-service', file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
  };

  const warnings = (): string[] =>
    mocks.logger.warn.mock.calls.map(([line]) => String(line));

  beforeEach(() => {
    rs.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-warn-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('should say nothing when every cron job has its entrypoint and handler', () => {
    write('src/cron.ts');
    write('src/cron/usage-report.cron.ts');

    const missing = warnMissingCronHandlers({
      infraConfig: {
        version: '1.0.0',
        dev: { scheduledJobs: [cron, trigger] },
      },
      environment: 'dev',
      projectRoot: root,
    });

    expect(missing).toEqual([]);
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it('should warn with the register-cron command when the handler is missing', () => {
    write('src/cron.ts');

    const missing = warnMissingCronHandlers({
      infraConfig: { version: '1.0.0', dev: { scheduledJobs: [cron] } },
      environment: 'dev',
      projectRoot: root,
    });

    expect(missing).toEqual(['usage-report']);
    expect(warnings()).toEqual([
      'Cron job "usage-report" (dev) has no code in apps/auth-service: missing src/cron/usage-report.cron.ts. A run would fail at start.',
      '   Create it: npx tsdevstack register-cron --service auth-service --name usage-report',
    ]);
  });

  it('should name both files when the service has no cron code at all', () => {
    warnMissingCronHandlers({
      infraConfig: { version: '1.0.0', dev: { scheduledJobs: [cron] } },
      environment: 'dev',
      projectRoot: root,
    });

    expect(warnings()[0]).toContain(
      'missing src/cron.ts and src/cron/usage-report.cron.ts',
    );
  });

  it('should ignore triggers, other environments and a missing file', () => {
    expect(
      warnMissingCronHandlers({
        infraConfig: {
          version: '1.0.0',
          dev: { scheduledJobs: [trigger] },
          prod: { scheduledJobs: [cron] },
        },
        environment: 'dev',
        projectRoot: root,
      }),
    ).toEqual([]);
    expect(
      warnMissingCronHandlers({
        infraConfig: null,
        environment: 'dev',
        projectRoot: root,
      }),
    ).toEqual([]);
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });
});
