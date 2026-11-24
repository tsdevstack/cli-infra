import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockLoadInfrastructureConfig = rs.fn();
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => mockLoadInfrastructureConfig(),
}));
const mockFindByName = rs.fn();
rs.mock('../discovery/find-azure-cron-job-by-name', () => ({
  findAzureCronJobByName: (...args: unknown[]) => mockFindByName(...args),
}));

import { resolveAzureScheduledJobResourceName } from './resolve-azure-scheduled-job-resource-name';

const credentials = {
  clientId: 'c',
  clientSecret: 's',
  tenantId: 't',
  subscriptionId: 'sub',
  location: 'swedencentral',
};

describe('resolveAzureScheduledJobResourceName', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockFindByName.mockResolvedValue(undefined);
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
          },
        ],
      },
    });
  });

  it("should map a trigger's name to its Container App Job", async () => {
    await expect(
      resolveAzureScheduledJobResourceName(
        'shop',
        'dev',
        'cleanup-tokens',
        credentials,
      ),
    ).resolves.toBe('shop-cleanup-tokens');
    expect(mockFindByName).not.toHaveBeenCalled();
  });

  it("should map a cron job's name to its Container App Job", async () => {
    await expect(
      resolveAzureScheduledJobResourceName(
        'shop',
        'dev',
        'usage-report',
        credentials,
      ),
    ).resolves.toBe('shop-cron-usage-report');
  });

  it('should find a cron job whose entry is gone by its tag', async () => {
    mockFindByName.mockResolvedValue('shop-cron-old-report');

    await expect(
      resolveAzureScheduledJobResourceName(
        'shop',
        'dev',
        'old-report',
        credentials,
      ),
    ).resolves.toBe('shop-cron-old-report');
    expect(mockFindByName).toHaveBeenCalledWith({
      name: 'old-report',
      projectName: 'shop',
      targetEnv: 'dev',
      credentials,
    });
  });

  it('should take a value that is no entry and no tagged cron job as the resource name itself', async () => {
    await expect(
      resolveAzureScheduledJobResourceName(
        'shop',
        'dev',
        'shop-old-job',
        credentials,
      ),
    ).resolves.toBe('shop-old-job');
    await expect(
      resolveAzureScheduledJobResourceName(
        'shop',
        'prod',
        'cleanup-tokens',
        credentials,
      ),
    ).resolves.toBe('cleanup-tokens');
  });
});
