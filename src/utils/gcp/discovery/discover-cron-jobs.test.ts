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
rs.mock('@google-cloud/run', () => ({
  JobsClient: class {
    listJobs = listJobs;
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpCloudRunName: (project: string, name: string, naming: string) =>
    naming === 'unique' ? `${project}-${name}` : name,
  GCP_PROJECT_LABEL: 'tsdevstack-project',
}));

import { discoverCronJobs } from './discover-cron-jobs';

const credentials = {
  project_id: 'gcp-shop',
  region: 'europe-west1',
  client_email: 'x@gcp-shop.iam.gserviceaccount.com',
  private_key: 'k',
};
const jobPath = (name: string) =>
  `projects/gcp-shop/locations/europe-west1/jobs/${name}`;

describe('discoverCronJobs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.buildGCPClientOptions.mockReturnValue({ credentials: {} });
  });

  it("should find this project's cron jobs by label, with their services and schedules", async () => {
    listJobs.mockResolvedValue([
      [
        {
          name: jobPath('shop-cron-usage-report'),
          labels: {
            'tsdevstack-project': 'shop',
            'tsdevstack-cron-service': 'auth-service',
            'tsdevstack-cron-job': 'usage-report',
          },
        },
        {
          name: jobPath('shop-cron-cleanup'),
          labels: {
            'tsdevstack-project': 'shop',
            'tsdevstack-cron-service': 'bff-service',
            'tsdevstack-cron-job': 'cleanup',
          },
        },
        // A migration job: no cron label
        {
          name: jobPath('shop-migrate-auth-service'),
          labels: { 'tsdevstack-project': 'shop' },
        },
      ],
    ]);

    await expect(
      discoverCronJobs({ projectName: 'shop', naming: 'unique', credentials }),
    ).resolves.toEqual([
      {
        name: 'usage-report',
        serviceName: 'auth-service',
        cloudRunJobName: 'shop-cron-usage-report',
        schedulerJobName: 'shop-usage-report',
      },
      {
        name: 'cleanup',
        serviceName: 'bff-service',
        cloudRunJobName: 'shop-cron-cleanup',
        schedulerJobName: 'shop-cleanup',
      },
    ]);
    expect(listJobs).toHaveBeenCalledWith({
      parent: 'projects/gcp-shop/locations/europe-west1',
    });
  });

  it("should leave out another project's cron jobs in the unique scheme", async () => {
    listJobs.mockResolvedValue([
      [
        {
          // A project whose name starts the same way, with the same service
          name: jobPath('shop-admin-cron-usage-report'),
          labels: {
            'tsdevstack-project': 'shop-admin',
            'tsdevstack-cron-service': 'auth-service',
            'tsdevstack-cron-job': 'usage-report',
          },
        },
        {
          name: jobPath('shop-cron-x'),
          labels: { 'tsdevstack-cron-service': 'auth-service' },
        },
      ],
    ]);

    await expect(
      discoverCronJobs({ projectName: 'shop', naming: 'unique', credentials }),
    ).resolves.toEqual([]);
  });

  it('should take every labeled cron job in a legacy environment', async () => {
    listJobs.mockResolvedValue([
      [
        {
          name: jobPath('cron-usage-report'),
          labels: {
            'tsdevstack-cron-service': 'auth-service',
            'tsdevstack-cron-job': 'usage-report',
          },
        },
      ],
    ]);

    await expect(
      discoverCronJobs({ projectName: 'shop', naming: 'legacy', credentials }),
    ).resolves.toEqual([
      {
        name: 'usage-report',
        serviceName: 'auth-service',
        cloudRunJobName: 'cron-usage-report',
        schedulerJobName: 'usage-report',
      },
    ]);
  });

  it("should pass the API's error on when the jobs can't be listed", async () => {
    listJobs.mockRejectedValue(new Error('7 PERMISSION_DENIED: run.jobs.list'));

    await expect(
      discoverCronJobs({ projectName: 'shop', naming: 'unique', credentials }),
    ).rejects.toThrow('7 PERMISSION_DENIED: run.jobs.list');
  });
});
