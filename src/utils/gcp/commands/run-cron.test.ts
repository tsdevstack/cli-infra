import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
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

const mockRunJob = rs.fn();
rs.mock('@google-cloud/scheduler', () => ({
  CloudSchedulerClient: class {
    runJob = mockRunJob;
  },
}));

const mockRunAndWait = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  runCloudRunJobAndWait: (...args: unknown[]) => mockRunAndWait(...args),
  buildGcpCloudRunName: (project: string, name: string, naming: string) =>
    naming === 'unique' ? `${project}-${name}` : name,
  isCronJob: (job: { type?: string }) => job.type === 'cron',
  CRON_JOB_TIMEOUT: { gcp: { min: 1, max: 604740, default: 600 } },
  CRON_JOB_PLATFORM_TIMEOUT_MARGIN_SECONDS: 60,
  CRON_JOB_NAME_PREFIX: 'cron-',
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

const mockPrintFailedRunLines = rs.fn();
rs.mock('../../logs/print-failed-run-lines', () => ({
  printFailedRunLines: (...args: unknown[]) => mockPrintFailedRunLines(...args),
}));
rs.mock('../logs/gcp-logs-reader', () => ({
  GcpLogsReader: class {
    constructor(public params: unknown) {}
  },
}));

const mockLoadInfrastructureConfig = rs.fn();
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => mockLoadInfrastructureConfig(),
}));

import { gcpRunCron } from './run-cron';

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

describe('gcpRunCron', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    process.exitCode = undefined;
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
            schedule: '0 3 * * *',
            targetService: 'auth-service',
            timeout: 1800,
          },
        ],
      },
    });
    mockRunAndWait.mockResolvedValue({ success: true, logs: 'ok' });
    mockRunJob.mockResolvedValue([{}]);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("should run a cron job's Cloud Run Job and wait its timeout plus the margin", async () => {
    await gcpRunCron(ctx, { job: 'usage-report' });

    expect(mockRunAndWait).toHaveBeenCalledWith(
      {},
      {
        projectId: 'gcp-shop',
        region: 'europe-west1',
        jobName: 'shop-cron-usage-report',
        credentials: ctx.credentials,
        timeoutSeconds: 1860,
        readLogs: false,
      },
    );
    expect(mocks.logger.success).toHaveBeenCalledWith(
      '"usage-report" finished: Succeeded',
    );
    expect(mockPrintFailedRunLines).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it("should report a failed run with Cloud Run's reason, its lines as infra:logs prints them, and exit code 1", async () => {
    mockRunAndWait.mockResolvedValue({
      success: false,
      logs: '',
      reason: 'Task e1-task0 failed with exit code: 1',
    });
    const before = Date.now();

    await gcpRunCron(ctx, { job: 'usage-report' });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      '"usage-report" failed: Task e1-task0 failed with exit code: 1',
    );
    const [params] = mockPrintFailedRunLines.mock.calls[0] as [
      {
        createReader: () => { params: unknown };
        source: unknown;
        startedAt: Date;
      },
    ];
    expect(params.source).toEqual({
      name: 'usage-report',
      type: 'cron',
      service: 'auth-service',
    });
    // The window starts when the run was started, not when it failed
    expect(params.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(params.startedAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(params.createReader().params).toEqual({
      projectName: 'shop',
      targetEnv: 'dev',
      credentials: ctx.credentials,
      naming: 'unique',
    });
    expect(process.exitCode).toBe(1);
  });

  it("should leave a failed run's lines out with lines false", async () => {
    mockRunAndWait.mockResolvedValue({
      success: false,
      logs: '',
      reason: 'Task e1-task0 failed with exit code: 1',
    });

    await gcpRunCron(ctx, { job: 'usage-report', lines: false });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      '"usage-report" failed: Task e1-task0 failed with exit code: 1',
    );
    expect(mockPrintFailedRunLines).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Log: npx tsdevstack infra:logs usage-report --env dev',
    );
    expect(process.exitCode).toBe(1);
  });

  it('should report a failed run without a reason plainly', async () => {
    mockRunAndWait.mockResolvedValue({ success: false, logs: '' });

    await gcpRunCron(ctx, { job: 'usage-report' });

    expect(mocks.logger.error).toHaveBeenCalledWith('"usage-report" failed');
    expect(mockPrintFailedRunLines).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });

  describe('A refused start (the InfraCoreError runCloudRunJobAndWait throws)', () => {
    /** The error as the helper builds it: the API's error is the cause */
    async function refusedStart(apiError: Error): Promise<Error> {
      const { InfraCoreError } = await rs.importActual<
        typeof import('@tsdevstack/infra-core')
      >('@tsdevstack/infra-core');
      return new InfraCoreError(
        'Failed to execute Cloud Run Job: shop-cron-usage-report',
        'cloud-run-jobs',
        apiError.message,
        { cause: apiError },
      );
    }

    it('should explain when the Cloud Run Job is not deployed', async () => {
      // google-gax's gRPC error: the code on the error, NOT_FOUND only in its message
      mockRunAndWait.mockRejectedValue(
        await refusedStart(
          Object.assign(
            new Error(
              "5 NOT_FOUND: Resource 'shop-cron-usage-report' of kind 'JOB' in region 'europe-west1' in project 'gcp-shop' does not exist.",
            ),
            { code: 5 },
          ),
        ),
      );

      await expect(
        gcpRunCron(ctx, { job: 'usage-report' }),
      ).rejects.toMatchObject({
        message:
          '"usage-report" is not deployed in dev (no Cloud Run Job shop-cron-usage-report)',
        hint: 'Deploy it first: npx tsdevstack infra:deploy-schedulers --env dev',
      });
    });

    it("should pass any other refusal on with the API's reason", async () => {
      mockRunAndWait.mockRejectedValue(
        await refusedStart(
          Object.assign(new Error('7 PERMISSION_DENIED: run.jobs.run'), {
            code: 7,
          }),
        ),
      );

      await expect(
        gcpRunCron(ctx, { job: 'usage-report' }),
      ).rejects.toMatchObject({
        message:
          'Could not run "usage-report": Failed to execute Cloud Run Job: shop-cron-usage-report (7 PERMISSION_DENIED: run.jobs.run)',
        hint: 'Log: npx tsdevstack infra:logs usage-report --env dev',
      });
    });
  });

  it("should run a trigger's Cloud Scheduler job and return after the start", async () => {
    await gcpRunCron(ctx, { job: 'cleanup-tokens' });

    expect(mockRunJob).toHaveBeenCalledWith({
      name: 'projects/gcp-shop/locations/europe-west1/jobs/shop-cleanup-tokens',
    });
    expect(mockRunAndWait).not.toHaveBeenCalled();
    expect(mocks.logger.success).toHaveBeenCalledWith(
      '"cleanup-tokens" started: Cloud Scheduler is calling auth-service/auth/jobs/cleanup-tokens',
    );
  });

  it('should refuse a name that is in no entry', async () => {
    await expect(gcpRunCron(ctx, { job: 'nope' })).rejects.toMatchObject({
      message: 'Scheduled job "nope" is not in dev',
    });
  });
});
