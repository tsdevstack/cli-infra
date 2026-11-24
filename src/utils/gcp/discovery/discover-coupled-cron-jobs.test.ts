import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockDiscoverCronJobs = rs.fn();
rs.mock('./discover-cron-jobs', () => ({
  discoverCronJobs: (...args: unknown[]) => mockDiscoverCronJobs(...args),
}));

import { discoverCoupledCronJobs } from './discover-coupled-cron-jobs';

const options = {
  serviceName: 'auth-service',
  projectName: 'shop',
  naming: 'unique' as const,
  credentials: {
    project_id: 'gcp-shop',
    region: 'europe-west1',
    client_email: 'x@gcp-shop.iam.gserviceaccount.com',
    private_key: 'k',
  },
};

describe('discoverCoupledCronJobs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it("should keep this project's cron jobs of the service", async () => {
    mockDiscoverCronJobs.mockResolvedValue([
      {
        name: 'usage-report',
        serviceName: 'auth-service',
        cloudRunJobName: 'shop-cron-usage-report',
        schedulerJobName: 'shop-usage-report',
      },
      {
        name: 'other',
        serviceName: 'bff-service',
        cloudRunJobName: 'shop-cron-other',
        schedulerJobName: 'shop-other',
      },
    ]);

    await expect(discoverCoupledCronJobs(options)).resolves.toEqual([
      {
        name: 'usage-report',
        cloudRunJobName: 'shop-cron-usage-report',
        schedulerJobName: 'shop-usage-report',
      },
    ]);
    expect(mockDiscoverCronJobs).toHaveBeenCalledWith({
      projectName: 'shop',
      naming: 'unique',
      credentials: options.credentials,
    });
  });

  it('should find nothing when the service has no cron jobs', async () => {
    mockDiscoverCronJobs.mockResolvedValue([]);
    await expect(discoverCoupledCronJobs(options)).resolves.toEqual([]);
  });
});
