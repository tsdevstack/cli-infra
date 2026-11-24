import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const start = rs.fn();
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class {
    jobs = { start };
  },
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
  isCronJob: (job: { type?: string }) => job.type === 'cron',
  CRON_JOB_TIMEOUT: { azure: { min: 1, max: 86400, default: 600 } },
  SCHEDULED_JOB_HTTP_TIMEOUT: { azure: { min: 15, max: 240, default: 240 } },
  CRON_JOB_NAME_PREFIX: 'cron-',
  CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS: 60,
}));

const mockWait = rs.fn();
rs.mock('./wait-for-job-execution', () => ({
  waitForJobExecution: (...args: unknown[]) => mockWait(...args),
}));

const mockLoadInfrastructureConfig = rs.fn();
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => mockLoadInfrastructureConfig(),
}));

import { azureRunCron } from './run-cron';

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

describe('azureRunCron', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    process.exitCode = undefined;
    mockLoadInfrastructureConfig.mockReturnValue({
      version: '1.0.0',
      dev: {
        scheduledJobs: [
          {
            name: 'cleanup-tokens',
            schedule: '0 3 * * *',
            targetService: 'auth-service',
            endpoint: '/auth/jobs/cleanup-tokens',
            httpTimeout: 120,
          },
          {
            name: 'usage-report',
            type: 'cron',
            schedule: '0 3 * * *',
            targetService: 'auth-service',
            timeout: 1800,
          },
        ],
      },
    });
    start.mockReturnValue({
      pollUntilDone: rs
        .fn()
        .mockResolvedValue({ name: 'shop-cron-usage-report-abc' }),
    });
    mockWait.mockResolvedValue({ status: 'Succeeded' });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("should start a cron job's Container App Job and wait for Azure's limit on it plus the start margin", async () => {
    await azureRunCron(ctx, { job: 'usage-report' });

    expect(start).toHaveBeenCalledWith(
      'shop-dev-rg',
      'shop-cron-usage-report',
      {},
    );
    expect(mockWait).toHaveBeenCalledWith(
      expect.anything(),
      'shop-dev-rg',
      'shop-cron-usage-report',
      'shop-cron-usage-report-abc',
      // replicaTimeout (timeout + 60 s margin + 300 s start), then 300 s to start
      1800 + 60 + 300 + 300,
    );
    expect(mocks.logger.success).toHaveBeenCalledWith(
      '"usage-report" finished: Succeeded',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Log: npx tsdevstack infra:logs usage-report --env dev',
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("should start a trigger's job too, waiting its httpTimeout plus the margin", async () => {
    await azureRunCron(ctx, { job: 'cleanup-tokens' });

    expect(start).toHaveBeenCalledWith(
      'shop-dev-rg',
      'shop-cleanup-tokens',
      {},
    );
    expect(mockWait).toHaveBeenCalledWith(
      expect.anything(),
      'shop-dev-rg',
      'shop-cleanup-tokens',
      expect.any(String),
      120 + 300,
    );
  });

  it('should report a failed run with exit code 1', async () => {
    mockWait.mockResolvedValue({ status: 'Failed', detail: 'exit code 1' });

    await azureRunCron(ctx, { job: 'usage-report' });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      '"usage-report" ended: Failed (exit code 1)',
    );
    // Its lines aren't in Log Analytics yet: the command says when they are
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "The run's log lines arrive 1 to 10 minutes after the run on Azure.",
    );
    expect(process.exitCode).toBe(1);
  });

  it('should explain when the job is not deployed', async () => {
    start.mockImplementation(() => {
      throw { statusCode: 404 };
    });

    await expect(
      azureRunCron(ctx, { job: 'usage-report' }),
    ).rejects.toMatchObject({
      message:
        '"usage-report" is not deployed in dev (no Container App Job shop-cron-usage-report)',
      hint: 'Deploy it first: npx tsdevstack infra:deploy-schedulers --env dev',
    });
  });

  it('should refuse a name that is in no entry', async () => {
    await expect(azureRunCron(ctx, { job: 'nope' })).rejects.toMatchObject({
      message: 'Scheduled job "nope" is not in dev',
      hint: 'Jobs in dev.scheduledJobs: cleanup-tokens, usage-report',
    });
    expect(start).not.toHaveBeenCalled();
  });
});
