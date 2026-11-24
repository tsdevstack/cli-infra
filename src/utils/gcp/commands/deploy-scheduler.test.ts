import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('node:fs', () => ({
  default: { existsSync: rs.fn(() => true) },
}));
rs.mock('inquirer', () => ({
  default: { prompt: rs.fn() },
}));
rs.mock('../naming/resolve-gcp-naming-scheme', () => ({
  resolveGcpNamingScheme: rs.fn(async () => 'unique'),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('../../terraform', () => ({
  toTerraformId: (name: string) => name.replace(/-/g, '_'),
}));

const mockExecuteTerraform = rs.fn();
rs.mock('../terraform', () => ({
  executeTerraform: (...args: unknown[]) => mockExecuteTerraform(...args),
}));

const mockSetSchedulerInvokerBindings = rs.fn();
const mockGenerateCloudSchedulerTf = rs.fn(
  (..._args: unknown[]) => '# cloud-scheduler.tf',
);
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpCloudRunName: (project: string, name: string, naming: string) =>
    naming === 'unique' ? `${project}-${name}` : name,
  buildGcpTerraformEnv: rs.fn(() => ({})),
  checkTerraformInstalled: rs.fn(),
  isCronJob: (job: { type?: string }) => job.type === 'cron',
  gcp: {
    generateCloudSchedulerTf: (...args: unknown[]) =>
      mockGenerateCloudSchedulerTf(...args),
  },
  setSchedulerInvokerBindings: (...args: unknown[]) =>
    mockSetSchedulerInvokerBindings(...args),
}));

const mockGcpDeployCronJobs = rs.fn();
rs.mock('./deploy-cron-jobs', () => ({
  gcpDeployCronJobs: (...args: unknown[]) => mockGcpDeployCronJobs(...args),
}));

const mockGetTriggerJobs = rs.fn();
const mockGetCronJobs = rs.fn();
rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getTriggerJobs: (...args: unknown[]) => mockGetTriggerJobs(...args),
  getCronJobs: (...args: unknown[]) => mockGetCronJobs(...args),
}));
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => ({ version: '1.0.0' })),
}));

import { gcpDeployScheduler } from './deploy-scheduler';

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
const trigger = {
  name: 'cleanup-tokens',
  schedule: '0 3 * * *',
  targetService: 'auth-service',
  endpoint: '/auth/jobs/cleanup-tokens',
};
const cronJob = {
  name: 'usage-report',
  type: 'cron' as const,
  schedule: '0 4 * * *',
  targetService: 'auth-service',
};
const frameworkConfig = { services: [] };

describe('gcpDeployScheduler', () => {
  let order: string[];

  beforeEach(() => {
    rs.clearAllMocks();
    order = [];
    mocks.loadFrameworkConfig.mockReturnValue(frameworkConfig);
    mockGetTriggerJobs.mockReturnValue([trigger]);
    mockGetCronJobs.mockReturnValue([cronJob]);
    mockExecuteTerraform.mockImplementation(
      async (command: string, options: { target?: string }) => {
        order.push(options.target ? `${command} ${options.target}` : command);
        return { success: true };
      },
    );
    mockSetSchedulerInvokerBindings.mockImplementation(async () => {
      order.push('bindings');
    });
    mockGcpDeployCronJobs.mockImplementation(async () => {
      order.push('cron jobs');
    });
  });

  it("should apply a cron job's schedule, then deploy its Cloud Run Job", async () => {
    // The apply creates the scheduler account; the job's deploy grants it run.invoker
    await gcpDeployScheduler(ctx, { job: 'usage-report', autoApprove: true });

    expect(order).toEqual([
      'init',
      'apply google_cloud_scheduler_job.usage_report',
      'cron jobs',
    ]);
    expect(mockGcpDeployCronJobs).toHaveBeenCalledWith(
      ctx,
      frameworkConfig,
      [cronJob],
      { naming: 'unique', commandName: 'infra:deploy-scheduler' },
    );
    expect(mockSetSchedulerInvokerBindings).not.toHaveBeenCalled();
  });

  it("should apply a trigger's schedule, then let the scheduler call its service", async () => {
    // The apply creates the scheduler account when it doesn't exist yet
    await gcpDeployScheduler(ctx, { job: 'cleanup-tokens', autoApprove: true });

    expect(order).toEqual([
      'init',
      'apply google_cloud_scheduler_job.cleanup_tokens',
      'bindings',
    ]);
    expect(mockSetSchedulerInvokerBindings).toHaveBeenCalledWith(
      {},
      {
        projectId: 'gcp-shop',
        projectName: 'shop',
        region: 'europe-west1',
        targetServices: ['shop-auth-service'],
        credentials: ctx.credentials,
      },
    );
    expect(mockGcpDeployCronJobs).not.toHaveBeenCalled();
  });

  it("should not touch the service's access when the trigger's apply fails", async () => {
    mockExecuteTerraform.mockImplementation(async (command: string) => ({
      success: command === 'init',
      error: 'boom',
    }));

    await expect(
      gcpDeployScheduler(ctx, { job: 'cleanup-tokens', autoApprove: true }),
    ).rejects.toMatchObject({
      message: 'Failed to deploy scheduled job: cleanup-tokens',
    });
    expect(mockSetSchedulerInvokerBindings).not.toHaveBeenCalled();
  });

  it("should not deploy the Cloud Run Job when the schedule's apply fails", async () => {
    mockExecuteTerraform.mockImplementation(async (command: string) => ({
      success: command === 'init',
      error: 'boom',
    }));

    await expect(
      gcpDeployScheduler(ctx, { job: 'usage-report', autoApprove: true }),
    ).rejects.toMatchObject({
      message: 'Failed to deploy scheduled job: usage-report',
    });
    expect(mockGcpDeployCronJobs).not.toHaveBeenCalled();
  });

  it('should refuse a name that is in no entry', async () => {
    await expect(
      gcpDeployScheduler(ctx, { job: 'nope', autoApprove: true }),
    ).rejects.toMatchObject({
      message: "Scheduled job 'nope' not found in config",
      hint: 'Available jobs: cleanup-tokens, usage-report',
    });
  });
});
