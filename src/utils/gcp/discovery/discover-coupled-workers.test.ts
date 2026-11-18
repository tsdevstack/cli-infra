import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockLoadFrameworkConfig, mockListCloudRunServices, mockWarn } =
  rs.hoisted(() => ({
    mockLoadFrameworkConfig: rs.fn(),
    mockListCloudRunServices: rs.fn(),
    mockWarn: rs.fn(),
  }));

rs.mock('../../../context', () => ({
  getContext: () => ({
    logger: { warn: mockWarn },
    loadFrameworkConfig: mockLoadFrameworkConfig,
  }),
}));

rs.mock('./list-cloud-run-services', () => ({
  listCloudRunServices: mockListCloudRunServices,
}));

import { discoverCoupledWorkers } from './discover-coupled-workers';

const BASE_ACCOUNT = 'auth-service@proj.iam.gserviceaccount.com';
const MYAPP = { 'tsdevstack-project': 'myapp' };

function cloudRun(
  name: string,
  serviceAccount: string,
  labels: Record<string, string> = {},
): object {
  return {
    name,
    fullName: `projects/proj/locations/us-central1/services/${name}`,
    serviceAccount,
    labels,
  };
}

function discover(): ReturnType<typeof discoverCoupledWorkers> {
  return discoverCoupledWorkers({
    projectName: 'myapp',
    naming: 'legacy',
    baseServiceName: 'auth-service',
    baseServiceAccount: BASE_ACCOUNT,
    projectId: 'proj',
    region: 'us-central1',
    credentials: {} as never,
  });
}

describe('discoverCoupledWorkers (GCP)', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockLoadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', type: 'nestjs' },
        {
          name: 'token-refresher',
          type: 'worker',
          baseService: 'auth-service',
        },
        {
          name: 'offers-worker',
          type: 'worker',
          baseService: 'offers-service',
        },
      ],
    });
  });

  describe('Standard use cases', () => {
    it('should find a worker registered for the service, whatever its name', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          cloudRun('auth-service', BASE_ACCOUNT),
          cloudRun('token-refresher', BASE_ACCOUNT),
        ],
      });

      expect(await discover()).toEqual([
        { name: 'token-refresher', cloudRunName: 'token-refresher' },
      ]);
    });

    it("should find a '-worker' that runs as the service's account", async () => {
      // Unregistered from config.json, still deployed
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [cloudRun('auth-worker', BASE_ACCOUNT)],
      });

      expect(await discover()).toEqual([
        { name: 'auth-worker', cloudRunName: 'auth-worker' },
      ]);
    });

    it("should leave another service's worker alone", async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          cloudRun(
            'offers-worker',
            'offers-service@proj.iam.gserviceaccount.com',
          ),
        ],
      });

      expect(await discover()).toEqual([]);
    });
  });

  describe('Edge cases', () => {
    it('should list a worker once when both rules match', async () => {
      mockLoadFrameworkConfig.mockReturnValue({
        services: [
          { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
        ],
      });
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [cloudRun('auth-worker', BASE_ACCOUNT)],
      });

      expect(await discover()).toEqual([
        { name: 'auth-worker', cloudRunName: 'auth-worker' },
      ]);
    });

    it('should still use the Cloud Run rule without a readable config.json', async () => {
      mockLoadFrameworkConfig.mockImplementation(() => {
        throw new Error('no config');
      });
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [cloudRun('auth-worker', BASE_ACCOUNT)],
      });

      expect(await discover()).toEqual([
        { name: 'auth-worker', cloudRunName: 'auth-worker' },
      ]);
    });

    it('should warn and find nothing when Cloud Run cannot be listed', async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: false,
        services: [],
        error: 'permission denied',
      });

      expect(await discover()).toEqual([]);
      expect(mockWarn).toHaveBeenCalledWith(
        'Could not list Cloud Run services: permission denied',
      );
    });
  });

  describe('Unique naming scheme', () => {
    it("should find the worker by its config name and skip other projects' services", async () => {
      mockListCloudRunServices.mockResolvedValue({
        success: true,
        services: [
          cloudRun('myapp-auth-service', BASE_ACCOUNT, MYAPP),
          cloudRun('myapp-token-refresher', BASE_ACCOUNT, MYAPP),
          cloudRun('other-auth-worker', BASE_ACCOUNT),
          // Project "myapp-admin": same prefix, its own label
          cloudRun('myapp-admin-worker', BASE_ACCOUNT, {
            'tsdevstack-project': 'myapp-admin',
          }),
        ],
      });

      expect(
        await discoverCoupledWorkers({
          projectName: 'myapp',
          naming: 'unique',
          baseServiceName: 'auth-service',
          baseServiceAccount: BASE_ACCOUNT,
          projectId: 'proj',
          region: 'us-central1',
          credentials: {} as never,
        }),
      ).toEqual([
        { name: 'token-refresher', cloudRunName: 'myapp-token-refresher' },
      ]);
    });
  });
});
