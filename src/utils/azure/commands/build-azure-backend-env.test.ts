/**
 * Tests for build-azure-backend-env
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockBuildBackendEnvVars = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildBackendEnvVars: (...args: unknown[]) => mockBuildBackendEnvVars(...args),
}));

const mockFetchSecret = rs.fn();
rs.mock('../../credentials/fetch-secret', () => ({
  fetchSecret: (...args: unknown[]) => mockFetchSecret(...args),
}));

import { buildAzureBackendEnv } from './build-azure-backend-env';

describe('buildAzureBackendEnv', () => {
  const baseConfig = {
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      subscriptionId: 'sub-123',
      tenantId: 'tenant-456',
      clientId: 'client-789',
      clientSecret: 'secret-abc',
      location: 'eastus',
    },
    serviceName: 'auth-service',
    hasDatabase: true,
    poolMax: 15,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockBuildBackendEnvVars.mockReturnValue({
      NODE_ENV: 'production',
      SECRETS_PROVIDER: 'azure',
      PROJECT_NAME: 'my-app',
      DB_POOL_MAX: '15',
    });
    mockFetchSecret.mockReturnValue('postgresql://user:pass@host/db');
  });

  describe('Standard env vars', () => {
    it('should call buildBackendEnvVars with azure provider', () => {
      buildAzureBackendEnv(baseConfig);

      expect(mockBuildBackendEnvVars).toHaveBeenCalledWith({
        provider: 'azure',
        projectName: 'my-app',
        projectId: 'sub-123',
        poolMax: 15,
      });
    });

    it('should convert standard env vars to array format', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          { name: 'NODE_ENV', value: 'production' },
          { name: 'SECRETS_PROVIDER', value: 'azure' },
          { name: 'PROJECT_NAME', value: 'my-app' },
          { name: 'DB_POOL_MAX', value: '15' },
        ]),
      );
    });
  });

  describe('Azure credential injection', () => {
    it('should inject AZURE_CLIENT_ID', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          { name: 'AZURE_CLIENT_ID', value: 'client-789' },
        ]),
      );
    });

    it('should inject AZURE_TENANT_ID', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          { name: 'AZURE_TENANT_ID', value: 'tenant-456' },
        ]),
      );
    });

    it('should inject AZURE_KEYVAULT_NAME', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          { name: 'AZURE_KEYVAULT_NAME', value: 'my-app-dev-kv' },
        ]),
      );
    });

    it('should add AZURE_CLIENT_SECRET as a secret ref', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.secrets).toEqual(
        expect.arrayContaining([
          { name: 'azure-client-secret', value: 'secret-abc' },
        ]),
      );
      expect(result.secretEnvVars).toEqual(
        expect.arrayContaining([
          { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' },
        ]),
      );
    });
  });

  describe('DATABASE_URL injection', () => {
    it('should fetch and inject DATABASE_URL when hasDatabase is true', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(mockFetchSecret).toHaveBeenCalledWith(
        'DATABASE_URL',
        'dev',
        'auth-service',
      );
      expect(result.secrets).toEqual(
        expect.arrayContaining([
          { name: 'database-url', value: 'postgresql://user:pass@host/db' },
        ]),
      );
      expect(result.secretEnvVars).toEqual(
        expect.arrayContaining([
          { name: 'DATABASE_URL', secretRef: 'database-url' },
        ]),
      );
    });

    it('should skip DATABASE_URL when hasDatabase is false', () => {
      const result = buildAzureBackendEnv({
        ...baseConfig,
        hasDatabase: false,
      });

      expect(mockFetchSecret).not.toHaveBeenCalled();
      expect(result.secrets).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'database-url' }),
        ]),
      );
    });

    it('should skip DATABASE_URL when fetchSecret returns null', () => {
      mockFetchSecret.mockReturnValue(null);

      const result = buildAzureBackendEnv(baseConfig);

      expect(result.secrets).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'database-url' }),
        ]),
      );
    });
  });

  describe('Logging', () => {
    it('should log Azure credentials injection', () => {
      buildAzureBackendEnv(baseConfig);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        '  Injecting Azure credentials for SecretsProvider',
      );
    });

    it('should log DATABASE_URL injection when present', () => {
      buildAzureBackendEnv(baseConfig);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        '  Injecting DATABASE_URL secret',
      );
    });
  });
});
