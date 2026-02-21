import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { fetchAllDbPasswords } from './fetch-all-db-passwords';

// Mock dependencies
rs.mock('../../../context', () => ({
  getContext: () => ({
    logger: {
      warn: rs.fn(),
    },
  }),
}));

rs.mock('../discovery', () => ({
  discoverDeployedServices: rs.fn(),
}));

rs.mock('../../credentials/fetch-secret', () => ({
  fetchSecret: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  toEnvVarPrefix: rs.fn((name: string) =>
    name.replace(/-/g, '_').toUpperCase(),
  ),
}));

rs.mock('../../terraform', () => ({
  toTfVarSuffix: rs.fn((name: string) => name.replace(/-/g, '_')),
}));

import { discoverDeployedServices } from '../discovery';
import { fetchSecret } from '../../credentials/fetch-secret';

describe('fetchAllDbPasswords', () => {
  const defaultOptions = {
    projectName: 'test-project',
    projectId: 'test-project-123',
    region: 'us-central1',
    sqlInstanceName: 'test-project-postgres',
    credentials: {
      project_id: 'test-project-123',
      region: 'us-central1',
      client_email: 'sa@test.iam.gserviceaccount.com',
      private_key: 'test-key',
    },
    targetEnv: 'dev',
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should return empty object when discovery fails', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: false,
      services: [],
      error: 'Discovery failed',
    });

    const result = await fetchAllDbPasswords(defaultOptions);

    expect(result).toEqual({});
  });

  it('should return empty object when no services have databases', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'frontend',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: false,
            secretCount: 0,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });

    const result = await fetchAllDbPasswords(defaultOptions);

    expect(result).toEqual({});
    expect(fetchSecret).not.toHaveBeenCalled();
  });

  it('should fetch passwords for services with databases', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: true,
            secretCount: 5,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
        {
          name: 'offers-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: true,
            secretCount: 5,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });

    rs.mocked(fetchSecret).mockImplementation((key: string) => {
      if (key === 'DB_AUTH_SERVICE_PASSWORD') return 'auth-pass-123';
      if (key === 'DB_OFFERS_SERVICE_PASSWORD') return 'offers-pass-456';
      return null;
    });

    const result = await fetchAllDbPasswords(defaultOptions);

    expect(result).toEqual({
      auth_service: 'auth-pass-123',
      offers_service: 'offers-pass-456',
    });
  });

  it('should skip services where password fetch fails', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: true,
            secretCount: 5,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
        {
          name: 'broken-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: true,
            secretCount: 5,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });

    rs.mocked(fetchSecret).mockImplementation((key: string) => {
      if (key === 'DB_AUTH_SERVICE_PASSWORD') return 'auth-pass-123';
      if (key === 'DB_BROKEN_SERVICE_PASSWORD')
        throw new Error('Secret not found');
      return null;
    });

    const result = await fetchAllDbPasswords(defaultOptions);

    expect(result).toEqual({
      auth_service: 'auth-pass-123',
    });
  });

  it('should skip services where password is undefined', async () => {
    rs.mocked(discoverDeployedServices).mockResolvedValue({
      success: true,
      services: [
        {
          name: 'auth-service',
          type: 'backend',
          status: 'SERVING',
          resources: {
            cloudRunService: true,
            hasDatabase: true,
            secretCount: 5,
            spaBucket: false,
            hasServiceAccount: true,
          },
        },
      ],
    });

    rs.mocked(fetchSecret).mockReturnValue(null);

    const result = await fetchAllDbPasswords(defaultOptions);

    expect(result).toEqual({});
  });
});
