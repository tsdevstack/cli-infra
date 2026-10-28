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
    hasStorage: false,
    poolMax: 15,
    managedIdentityClientId: 'mi-client-id-123',
    secretsIdentityClientId: 'secrets-client-id-456',
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

  describe('Key Vault access', () => {
    it('should inject the shared identity as AZURE_CLIENT_ID', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          { name: 'AZURE_CLIENT_ID', value: 'mi-client-id-123' },
        ]),
      );
    });

    it("should inject the service's own identity as AZURE_SECRETS_CLIENT_ID", () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          { name: 'AZURE_SECRETS_CLIENT_ID', value: 'secrets-client-id-456' },
        ]),
      );
    });

    it('should inject the shared vault and the service vault names', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          { name: 'AZURE_KEYVAULT_NAME', value: 'my-app-dev-kv' },
          {
            name: 'AZURE_SERVICE_KEYVAULT_NAME',
            value: 'my-app-dev-auth-service',
          },
        ]),
      );
    });

    it('should never inject the deploy credentials', () => {
      const result = buildAzureBackendEnv(baseConfig);

      const names = result.envVars.map((v) => v.name);
      expect(names).not.toContain('AZURE_TENANT_ID');
      expect(result.secrets).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'azure-client-secret' }),
        ]),
      );
      expect(result.secretEnvVars).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'AZURE_CLIENT_SECRET' }),
        ]),
      );
      expect(JSON.stringify(result)).not.toContain('secret-abc');
    });

    it('should fail without the managed identity instead of falling back', () => {
      expect(() =>
        buildAzureBackendEnv({
          ...baseConfig,
          managedIdentityClientId: undefined,
        }),
      ).toThrow(
        'The Container Apps managed identity is missing from the Terraform outputs',
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

  describe('AZURE_STORAGE_ACCOUNT_NAME injection', () => {
    it('should inject storage account name when hasStorage is true', () => {
      const result = buildAzureBackendEnv({
        ...baseConfig,
        hasStorage: true,
      });

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: 'myappdevstorage' },
        ]),
      );
    });

    it('should NOT inject storage account name when hasStorage is false', () => {
      const result = buildAzureBackendEnv(baseConfig);

      expect(result.envVars).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'AZURE_STORAGE_ACCOUNT_NAME' }),
        ]),
      );
    });

    it('should strip non-alphanumeric chars from project name in storage account', () => {
      const result = buildAzureBackendEnv({
        ...baseConfig,
        projectName: 'my-cool-app',
        hasStorage: true,
      });

      expect(result.envVars).toEqual(
        expect.arrayContaining([
          {
            name: 'AZURE_STORAGE_ACCOUNT_NAME',
            value: 'mycoolappdevstorage',
          },
        ]),
      );
    });
  });

  describe('Logging', () => {
    it('should log the managed identities injection', () => {
      buildAzureBackendEnv(baseConfig);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        '  Injecting managed identities and Key Vault names',
      );
    });

    it('should log storage account injection when hasStorage is true', () => {
      buildAzureBackendEnv({ ...baseConfig, hasStorage: true });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        '  Injecting storage account name for StorageModule',
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
