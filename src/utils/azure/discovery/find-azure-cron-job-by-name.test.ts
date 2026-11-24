import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const listJobs = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class {
    jobs = { listByResourceGroup: listJobs };
  },
}));

import { findAzureCronJobByName } from './find-azure-cron-job-by-name';

async function* items<T>(list: T[]): AsyncGenerator<T> {
  for (const item of list) yield item;
}

const options = {
  name: 'usage-report',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    clientId: 'c',
    clientSecret: 's',
    tenantId: 't',
    subscriptionId: 'sub',
    location: 'swedencentral',
  },
};

describe('findAzureCronJobByName', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it("should find the job tagged with the cron job's name in the environment's resource group", async () => {
    listJobs.mockReturnValue(
      items([
        { name: 'shop-cleanup-tokens' },
        {
          name: 'shop-cron-other',
          tags: { 'tsdevstack-cron-job': 'other' },
        },
        {
          name: 'shop-cron-usage-report',
          tags: {
            'tsdevstack-cron-service': 'auth-service',
            'tsdevstack-cron-job': 'usage-report',
          },
        },
      ]),
    );

    await expect(findAzureCronJobByName(options)).resolves.toBe(
      'shop-cron-usage-report',
    );
    expect(listJobs).toHaveBeenCalledWith('shop-dev-rg');
  });

  it('should find nothing without a tagged job or a resource group', async () => {
    listJobs.mockReturnValue(items([{ name: 'shop-cleanup-tokens' }]));
    await expect(findAzureCronJobByName(options)).resolves.toBeUndefined();

    listJobs.mockImplementation(() => {
      throw Object.assign(new Error('not found'), { statusCode: 404 });
    });
    await expect(findAzureCronJobByName(options)).resolves.toBeUndefined();
  });

  it("should pass Azure's other errors on", async () => {
    listJobs.mockImplementation(() => {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    });

    await expect(findAzureCronJobByName(options)).rejects.toThrow('Forbidden');
  });
});
