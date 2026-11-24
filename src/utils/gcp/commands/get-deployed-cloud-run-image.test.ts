import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const getService = rs.fn();
rs.mock('@google-cloud/run', () => ({
  ServicesClient: class {
    getService = getService;
  },
}));

import { getDeployedCloudRunImage } from './get-deployed-cloud-run-image';

const credentials = {
  project_id: 'gcp-shop',
  region: 'europe-west1',
  client_email: 'x@gcp-shop.iam.gserviceaccount.com',
  private_key: 'k',
};

describe('getDeployedCloudRunImage', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.buildGCPClientOptions.mockReturnValue({ credentials: {} });
  });

  it("should return the first container's image", async () => {
    getService.mockResolvedValue([
      { template: { containers: [{ image: 'registry/auth-service:abc' }] } },
    ]);

    await expect(
      getDeployedCloudRunImage(credentials, 'shop-auth-service'),
    ).resolves.toBe('registry/auth-service:abc');
    expect(getService).toHaveBeenCalledWith({
      name: 'projects/gcp-shop/locations/europe-west1/services/shop-auth-service',
    });
  });

  it('should return undefined when the service does not exist', async () => {
    getService.mockRejectedValue({ code: 5 });

    await expect(
      getDeployedCloudRunImage(credentials, 'shop-auth-service'),
    ).resolves.toBeUndefined();
  });

  it('should pass any other error on', async () => {
    getService.mockRejectedValue(new Error('PERMISSION_DENIED'));

    await expect(
      getDeployedCloudRunImage(credentials, 'shop-auth-service'),
    ).rejects.toThrow('PERMISSION_DENIED');
  });
});
