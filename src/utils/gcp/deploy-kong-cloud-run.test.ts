import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockUpdateService = rs.fn();

rs.mock('@google-cloud/run', () => ({
  ServicesClient: class MockServicesClient {
    updateService(...args: unknown[]) {
      return mockUpdateService(...args);
    }
  },
}));

const mockLogger = {
  info: rs.fn(),
};

class MockCliError extends Error {
  constructor(
    message: string,
    public context?: string,
    public hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

rs.mock('../../context', () => ({
  getContext: () => ({
    logger: mockLogger,
    CliError: MockCliError,
    buildGCPClientOptions: () => ({}),
  }),
}));

import { deployKongCloudRun } from './deploy-kong-cloud-run';
import type { KongDeployOptions } from './deploy-kong-cloud-run';

const baseOptions: KongDeployOptions = {
  projectId: 'my-gcp-project',
  projectName: 'myapp',
  region: 'us-central1',
  imageUri: 'gcr.io/my-gcp-project/kong:abc123',
  vpcNetwork: 'projects/my-gcp-project/global/networks/myapp-vpc',
  vpcSubnet:
    'projects/my-gcp-project/regions/us-central1/subnetworks/myapp-subnet',
  serviceAccount: 'kong-sa@my-gcp-project.iam.gserviceaccount.com',
  credentials: {
    project_id: 'my-gcp-project',
    region: 'us-central1',
    client_email: 'sa@project.iam.gserviceaccount.com',
    private_key: 'key',
  },
  minInstances: 0,
  maxInstances: 2,
  cpu: '1',
  memory: '512Mi',
};

describe('deployKongCloudRun', () => {
  beforeEach(() => {
    rs.resetAllMocks();

    mockUpdateService.mockResolvedValue([
      {
        promise: () =>
          Promise.resolve([{ uri: 'https://myapp-kong-abc123.run.app' }]),
      },
    ]);
  });

  describe('Standard use cases', () => {
    it('should call updateService with correct service config', async () => {
      await deployKongCloudRun(baseOptions);

      expect(mockUpdateService).toHaveBeenCalledWith(
        expect.objectContaining({
          allowMissing: true,
          service: expect.objectContaining({
            name: 'projects/my-gcp-project/locations/us-central1/services/myapp-kong',
            ingress: 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',
          }),
        }),
      );
    });

    it('should return success with service URL', async () => {
      const result = await deployKongCloudRun(baseOptions);

      expect(result).toEqual({
        success: true,
        serviceUrl: 'https://myapp-kong-abc123.run.app',
      });
    });

    it('should configure container with correct image and port', async () => {
      await deployKongCloudRun(baseOptions);

      const callArgs = mockUpdateService.mock.calls[0][0];
      const containers = callArgs.service.template.containers;

      expect(containers[0].image).toBe('gcr.io/my-gcp-project/kong:abc123');
      expect(containers[0].ports[0].containerPort).toBe(8080);
    });

    it('should configure VPC access with Direct VPC Egress', async () => {
      await deployKongCloudRun(baseOptions);

      const callArgs = mockUpdateService.mock.calls[0][0];
      const vpcAccess = callArgs.service.template.vpcAccess;

      expect(vpcAccess.egress).toBe('PRIVATE_RANGES_ONLY');
      expect(vpcAccess.networkInterfaces[0].network).toBe(
        baseOptions.vpcNetwork,
      );
      expect(vpcAccess.networkInterfaces[0].subnetwork).toBe(
        baseOptions.vpcSubnet,
      );
    });

    it('should configure scaling from options', async () => {
      await deployKongCloudRun({
        ...baseOptions,
        minInstances: 1,
        maxInstances: 5,
      });

      const callArgs = mockUpdateService.mock.calls[0][0];
      const scaling = callArgs.service.template.scaling;

      expect(scaling.minInstanceCount).toBe(1);
      expect(scaling.maxInstanceCount).toBe(5);
    });

    it('should set only the client address settings, no secrets', async () => {
      await deployKongCloudRun(baseOptions);

      const callArgs = mockUpdateService.mock.calls[0][0];
      const container = callArgs.service.template.containers[0];

      // Secrets are baked into the image; the environment only tells Kong to
      // read the client's address from the load balancer's header
      expect(container.env).toEqual([
        { name: 'KONG_TRUSTED_IPS', value: '0.0.0.0/0,::/0' },
        { name: 'KONG_REAL_IP_HEADER', value: 'X-Tsdevstack-Edge-IP' },
        { name: 'KONG_REAL_IP_RECURSIVE', value: 'off' },
      ]);
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when deployment fails', async () => {
      mockUpdateService.mockRejectedValue(new Error('Permission denied'));

      await expect(deployKongCloudRun(baseOptions)).rejects.toThrow(
        MockCliError,
      );
    });

    it('should include original error message in CliError hint', async () => {
      mockUpdateService.mockRejectedValue(new Error('Permission denied'));

      try {
        await deployKongCloudRun(baseOptions);
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MockCliError);
        expect((error as MockCliError).hint).toBe('Permission denied');
      }
    });
  });
});
