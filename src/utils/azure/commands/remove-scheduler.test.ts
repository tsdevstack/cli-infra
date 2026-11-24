import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));
rs.mock('inquirer', () => ({ default: { prompt: rs.fn() } }));
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class {},
}));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

const mockDeleteJob = rs.fn();
rs.mock('../delete', () => ({
  deleteContainerAppJob: (...args: unknown[]) => mockDeleteJob(...args),
}));
const mockResolve = rs.fn();
rs.mock('./resolve-azure-scheduled-job-resource-name', () => ({
  resolveAzureScheduledJobResourceName: (...args: unknown[]) =>
    mockResolve(...args),
}));

rs.mock('./build-azure-scheduled-job-resource-name', () => ({
  buildAzureScheduledJobResourceName: (
    projectName: string,
    entry: { name: string; type?: string },
  ) =>
    entry.type === 'cron'
      ? `${projectName}-cron-${entry.name}`
      : `${projectName}-${entry.name}`,
}));
const mockRemind = rs.fn();
rs.mock('../../infrastructure/remind-to-remove-scheduled-job-entry', () => ({
  remindToRemoveScheduledJobEntry: (...args: unknown[]) => mockRemind(...args),
}));

import { azureRemoveScheduler } from './remove-scheduler';

/** The predicate the command handed the entry reminder */
function remindedEntry(): (entry: { name: string; type?: string }) => boolean {
  expect(mockRemind).toHaveBeenCalledWith('dev', expect.any(Function));
  return mockRemind.mock.calls[0][1] as (entry: {
    name: string;
    type?: string;
  }) => boolean;
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
  runningInCI: true,
};

describe('azureRemoveScheduler', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockDeleteJob.mockResolvedValue({ success: true, deleted: true });
  });

  it('should delete the Container App Job the --job value resolves to, a removed entry found by its tag', async () => {
    mockResolve.mockResolvedValue('shop-cron-old-report');

    await azureRemoveScheduler(ctx, { job: 'old-report', confirm: true });

    expect(mockResolve).toHaveBeenCalledWith(
      'shop',
      'dev',
      'old-report',
      ctx.credentials,
    );
    expect(mockDeleteJob).toHaveBeenCalledWith({
      credentials: ctx.credentials,
      resourceGroupName: 'shop-dev-rg',
      jobName: 'shop-cron-old-report',
    });
    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Deleted job: shop-cron-old-report',
    );
  });

  it("should delete nothing when the jobs can't be listed", async () => {
    mockResolve.mockRejectedValue(new Error('Forbidden'));

    await expect(
      azureRemoveScheduler(ctx, { job: 'old-report', confirm: true }),
    ).rejects.toMatchObject({
      message: "Could not list the environment's Container App Jobs",
      hint: 'Forbidden. Nothing was deleted; run the command again.',
    });
    expect(mockDeleteJob).not.toHaveBeenCalled();
  });
  describe('Entry reminder', () => {
    it("should match the entry by the --job name or the job's resource name", async () => {
      mockResolve.mockResolvedValue('shop-cron-usage-report');

      await azureRemoveScheduler(ctx, { job: 'usage-report', confirm: true });

      const isRemovedJob = remindedEntry();
      expect(isRemovedJob({ name: 'usage-report', type: 'cron' })).toBe(true);
      expect(isRemovedJob({ name: 'cleanup-tokens' })).toBe(false);
    });

    it('should match a trigger given by its resource name', async () => {
      mockResolve.mockResolvedValue('shop-cleanup-tokens');

      await azureRemoveScheduler(ctx, {
        job: 'shop-cleanup-tokens',
        confirm: true,
      });

      expect(remindedEntry()({ name: 'cleanup-tokens' })).toBe(true);
    });
  });
});
