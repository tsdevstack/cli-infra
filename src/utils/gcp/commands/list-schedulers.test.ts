import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('../naming/resolve-gcp-naming-scheme', () => ({
  resolveGcpNamingScheme: rs.fn(async () => 'unique'),
}));

const listJobs = rs.fn();
rs.mock('@google-cloud/scheduler', () => ({
  CloudSchedulerClient: class {
    listJobs = listJobs;
  },
}));
const listExecutions = rs.fn();
rs.mock('@google-cloud/run', () => ({
  ExecutionsClient: class {
    listExecutions = listExecutions;
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpCloudRunName: (project: string, name: string, naming: string) =>
    naming === 'unique' ? `${project}-${name}` : name,
  isCronJob: (job: { type?: string }) => job.type === 'cron',
  CRON_JOB_NAME_PREFIX: 'cron-',
}));

const mockLoadInfrastructureConfig = rs.fn();
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => mockLoadInfrastructureConfig(),
}));

import { gcpListSchedulers } from './list-schedulers';

const ctx = {
  projectRoot: '/project',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    project_id: 'gcp-shop',
    region: 'europe-west1',
    client_email: 'x@gcp-shop.iam.gserviceaccount.com',
    private_key: 'k',
  },
  runningInCI: false,
};

function lines(fn: ReturnType<typeof rs.fn>): string[] {
  return fn.mock.calls.map(([line]) => String(line));
}

describe('gcpListSchedulers', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.buildGCPClientOptions.mockReturnValue({ credentials: {} });
    mockLoadInfrastructureConfig.mockReturnValue({
      version: '1.0.0',
      dev: {
        scheduledJobs: [
          {
            name: 'cleanup-tokens',
            schedule: '0 3 * * *',
            targetService: 'auth-service',
            endpoint: '/auth/jobs/cleanup-tokens',
          },
          {
            name: 'usage-report',
            type: 'cron',
            schedule: '0 4 * * *',
            targetService: 'auth-service',
          },
          {
            name: 'missing',
            type: 'cron',
            schedule: '0 5 * * *',
            targetService: 'auth-service',
          },
        ],
      },
    });
    listJobs.mockResolvedValue([
      [
        {
          name: 'projects/gcp-shop/locations/europe-west1/jobs/shop-cleanup-tokens',
          state: 'ENABLED',
          lastAttemptTime: { seconds: Date.UTC(2026, 10, 19, 4) / 1000 },
        },
        {
          name: 'projects/gcp-shop/locations/europe-west1/jobs/shop-usage-report',
          state: 'ENABLED',
        },
      ],
    ]);
    listExecutions.mockResolvedValue([
      [
        {
          name: 'e1',
          createTime: { seconds: Date.UTC(2026, 10, 18, 4) / 1000 },
          completionTime: {},
          succeededCount: 0,
          failedCount: 1,
        },
        {
          name: 'e2',
          createTime: { seconds: Date.UTC(2026, 10, 19, 4, 20) / 1000 },
          completionTime: {},
          succeededCount: 1,
          failedCount: 0,
        },
      ],
    ]);
  });

  it("should list both kinds, a trigger's last attempt and a cron job's newest execution", async () => {
    await gcpListSchedulers(ctx);

    const rows = [...lines(mocks.logger.success), ...lines(mocks.logger.warn)];
    const trigger = rows.find((r) => r.startsWith('cleanup-tokens'));
    expect(trigger).toContain('| trigger');
    expect(trigger).toContain('auth-service/auth/jobs/cleanup-tokens');
    expect(trigger).toContain('2026-11-19T04:00:00.000Z');

    const cron = rows.find((r) => r.startsWith('usage-report'));
    expect(cron).toContain('| cron ');
    expect(cron).toContain('| 0 4 * * *');
    expect(cron).toContain('✓ ENABLED');
    expect(cron).toContain('Succeeded 2026-11-19T04:20:00.000Z');
    expect(listExecutions).toHaveBeenCalledWith({
      parent:
        'projects/gcp-shop/locations/europe-west1/jobs/shop-cron-usage-report',
    });

    const missing = rows.find((r) => r.startsWith('missing'));
    expect(missing).toContain('✗ NOT FOUND');
    expect(lines(mocks.logger.warn)).toContain('1 job(s) not deployed. Run:');
  });

  it('should warn without scheduled jobs', async () => {
    mockLoadInfrastructureConfig.mockReturnValue({ version: '1.0.0', dev: {} });

    await gcpListSchedulers(ctx);

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "No scheduled jobs configured for environment 'dev'",
    );
    expect(listJobs).not.toHaveBeenCalled();
  });
});
