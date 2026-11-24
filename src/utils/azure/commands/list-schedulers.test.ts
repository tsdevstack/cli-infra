import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const listJobs = rs.fn();
const listExecutions = rs.fn();
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class {
    jobs = { listByResourceGroup: listJobs };
    jobsExecutions = { list: listExecutions };
  },
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
  isCronJob: (job: { type?: string }) => job.type === 'cron',
  CRON_JOB_NAME_PREFIX: 'cron-',
}));

const mockLoadInfrastructureConfig = rs.fn();
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => mockLoadInfrastructureConfig(),
}));

import { azureListSchedulers } from './list-schedulers';

async function* items<T>(list: T[]): AsyncGenerator<T> {
  for (const item of list) yield item;
}

const ctx = {
  projectRoot: '/project',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    clientId: 'c',
    clientSecret: 's',
    tenantId: 't',
    subscriptionId: 'sub',
    location: 'swedencentral',
  },
  runningInCI: false,
};

function lines(fn: ReturnType<typeof rs.fn>): string[] {
  return fn.mock.calls.map(([line]) => String(line));
}

describe('azureListSchedulers', () => {
  beforeEach(() => {
    rs.clearAllMocks();
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
    listJobs.mockReturnValue(
      items([
        {
          name: 'shop-cleanup-tokens',
          provisioningState: 'Succeeded',
          runningState: 'Ready',
        },
        {
          name: 'shop-cron-usage-report',
          provisioningState: 'Succeeded',
          runningState: 'Ready',
        },
      ]),
    );
    listExecutions.mockImplementation((_rg: string, jobName: string) =>
      items(
        jobName === 'shop-cron-usage-report'
          ? [
              {
                name: 'shop-cron-usage-report-a',
                status: 'Failed',
                startTime: new Date('2026-11-18T03:00:00Z'),
              },
              {
                name: 'shop-cron-usage-report-b',
                status: 'Succeeded',
                startTime: new Date('2026-11-19T03:00:00Z'),
              },
            ]
          : [],
      ),
    );
  });

  it('should list both kinds with their kind, state and last run', async () => {
    await azureListSchedulers(ctx);

    const rows = [...lines(mocks.logger.success), ...lines(mocks.logger.warn)];
    const cron = rows.find((r) => r.startsWith('usage-report'));
    expect(cron).toContain('| cron ');
    expect(cron).toContain('| 0 4 * * *');
    expect(cron).toContain('| auth-service');
    // The schedule's state, not the deploy's "Succeeded"
    expect(cron).toContain('✓ Ready');
    expect(cron).toContain('Succeeded 2026-11-19T03:00:00.000Z');

    const trigger = rows.find((r) => r.startsWith('cleanup-tokens'));
    expect(trigger).toContain('| trigger');
    expect(trigger).toContain('auth-service/auth/jobs/cleanup-tokens');
    expect(trigger).toContain('never ran');

    const missing = rows.find((r) => r.startsWith('missing'));
    expect(missing).toContain('✗ NOT FOUND');
    expect(listExecutions).toHaveBeenCalledTimes(2);
  });

  it("should show a suspended job's state, and a deploy that did not succeed", async () => {
    listJobs.mockReturnValue(
      items([
        {
          name: 'shop-cleanup-tokens',
          provisioningState: 'Succeeded',
          runningState: 'Suspended',
        },
        { name: 'shop-cron-usage-report', provisioningState: 'Failed' },
      ]),
    );

    await azureListSchedulers(ctx);

    const rows = lines(mocks.logger.success);
    expect(rows.find((r) => r.startsWith('cleanup-tokens'))).toContain(
      '✓ Suspended',
    );
    expect(rows.find((r) => r.startsWith('usage-report'))).toContain(
      '✓ Failed',
    );
  });

  it('should say Deployed when Azure gives no running state', async () => {
    listJobs.mockReturnValue(
      items([{ name: 'shop-cleanup-tokens', provisioningState: 'Succeeded' }]),
    );

    await azureListSchedulers(ctx);

    expect(
      lines(mocks.logger.success).find((r) => r.startsWith('cleanup-tokens')),
    ).toContain('✓ Deployed');
  });

  it('should say when jobs are not deployed', async () => {
    await azureListSchedulers(ctx);

    expect(lines(mocks.logger.warn)).toContain('1 job(s) not deployed. Run:');
    expect(lines(mocks.logger.info)).toContain(
      '  npx tsdevstack infra:deploy-schedulers --env dev',
    );
  });

  it('should warn without scheduled jobs', async () => {
    mockLoadInfrastructureConfig.mockReturnValue({ version: '1.0.0', dev: {} });

    await azureListSchedulers(ctx);

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "No scheduled jobs configured for environment 'dev'",
    );
    expect(listJobs).not.toHaveBeenCalled();
  });
});
