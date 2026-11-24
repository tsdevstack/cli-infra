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

import { discoverCoupledCronJobs } from './discover-coupled-cron-jobs';

async function* items<T>(list: T[]): AsyncGenerator<T> {
  for (const item of list) yield item;
}

const options = {
  serviceName: 'auth-service',
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

describe('discoverCoupledCronJobs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should find the jobs tagged with the service, by their config names', async () => {
    listJobs.mockReturnValue(
      items([
        {
          name: 'shop-cron-usage-report',
          tags: {
            'tsdevstack-cron-service': 'auth-service',
            'tsdevstack-cron-job': 'usage-report',
          },
        },
        {
          name: 'shop-cron-other',
          tags: { 'tsdevstack-cron-service': 'bff-service' },
        },
        { name: 'shop-cleanup-tokens' },
        { name: 'migrate-auth-service', tags: {} },
      ]),
    );

    await expect(discoverCoupledCronJobs(options)).resolves.toEqual([
      { name: 'usage-report', jobName: 'shop-cron-usage-report' },
    ]);
    expect(listJobs).toHaveBeenCalledWith('shop-dev-rg');
  });

  it('should fall back to the resource name when the job name tag is missing', async () => {
    listJobs.mockReturnValue(
      items([
        {
          name: 'shop-cron-x',
          tags: { 'tsdevstack-cron-service': 'auth-service' },
        },
      ]),
    );

    await expect(discoverCoupledCronJobs(options)).resolves.toEqual([
      { name: 'shop-cron-x', jobName: 'shop-cron-x' },
    ]);
  });

  it('should find nothing without a resource group', async () => {
    listJobs.mockImplementation(() => {
      throw { statusCode: 404 };
    });

    await expect(discoverCoupledCronJobs(options)).resolves.toEqual([]);
  });
});
