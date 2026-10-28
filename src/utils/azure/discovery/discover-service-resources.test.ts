/**
 * Tests for discover-service-resources
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

// infrastructure.json (database.serverName override)
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

// Mock Azure SDKs (transitive imports from the sub-modules)
rs.mock('@azure/identity', () => ({
  ClientSecretCredential: class MockClientSecretCredential {
    constructor() {}
  },
}));
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class MockContainerAppsAPIClient {
    constructor() {}
  },
}));
rs.mock('@azure/arm-storage', () => ({
  StorageManagementClient: class MockStorageManagementClient {
    constructor() {}
  },
}));
rs.mock('@azure/keyvault-secrets', () => ({
  SecretClient: class MockSecretClient {
    constructor() {}
  },
}));
rs.mock('@azure/arm-postgresql-flexible', () => ({
  PostgreSQLManagementFlexibleServerClient: class MockPostgreSQLManagementFlexibleServerClient {
    constructor() {}
  },
}));

// Mock the individual discovery functions
rs.mock('./get-container-app', { mock: true });
rs.mock('./storage-account-exists', { mock: true });
rs.mock('./list-keyvault-secrets-by-prefix', { mock: true });
rs.mock('./database-exists', { mock: true });

import { discoverServiceResources } from './discover-service-resources';
import { getContainerApp } from './get-container-app';
import { storageAccountExists } from './storage-account-exists';
import { listKeyVaultSecretsByPrefix } from './list-keyvault-secrets-by-prefix';
import { databaseExists } from './database-exists';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

const baseOptions = {
  projectName: 'myproject',
  targetEnv: 'dev',
  credentials: testCredentials,
};

describe('discoverServiceResources', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    // Default to "nothing exists"
    rs.mocked(getContainerApp).mockResolvedValue({
      success: true,
      app: { exists: false },
    });
    rs.mocked(storageAccountExists).mockResolvedValue({ exists: false });
    rs.mocked(listKeyVaultSecretsByPrefix).mockResolvedValue({
      success: true,
      secrets: [],
    });
    rs.mocked(databaseExists).mockResolvedValue({ exists: false });
    rs.mocked(loadInfrastructureConfig).mockReturnValue(null);
  });

  describe('Backend service', () => {
    it('should infer type as backend when container app exists with standard name', async () => {
      rs.mocked(getContainerApp).mockResolvedValue({
        success: true,
        app: {
          exists: true,
          status: 'Succeeded',
          fqdn: 'myproject-auth-service.azurecontainerapps.io',
          replicas: 1,
          image: 'myacr.azurecr.io/auth-service:latest',
        },
      });
      rs.mocked(listKeyVaultSecretsByPrefix).mockResolvedValue({
        success: true,
        secrets: [
          'myproject-auth-service-DATABASE-URL',
          'myproject-auth-service-JWT-SECRET',
        ],
      });
      rs.mocked(databaseExists).mockResolvedValue({ exists: true });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'auth-service',
      });

      expect(result.containerApp).toBe(true);
      expect(result.containerAppStatus).toBe('Succeeded');
      expect(result.containerAppUrl).toBe(
        'myproject-auth-service.azurecontainerapps.io',
      );
      expect(result.containerAppReplicas).toBe(1);
      expect(result.containerAppImage).toBe(
        'myacr.azurecr.io/auth-service:latest',
      );
      expect(result.spaBucket).toBe(false);
      expect(result.inferredType).toBe('backend');
      expect(result.hasDatabase).toBe(true);
      expect(result.secrets).toEqual([
        'myproject-auth-service-DATABASE-URL',
        'myproject-auth-service-JWT-SECRET',
      ]);
    });

    it('should set hasDatabase to false when database does not exist', async () => {
      rs.mocked(getContainerApp).mockResolvedValue({
        success: true,
        app: {
          exists: true,
          status: 'Succeeded',
          fqdn: 'myproject-bff-service.azurecontainerapps.io',
          replicas: 1,
          image: 'myacr.azurecr.io/bff-service:latest',
        },
      });
      rs.mocked(databaseExists).mockResolvedValue({ exists: false });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'bff-service',
      });

      expect(result.inferredType).toBe('backend');
      expect(result.hasDatabase).toBe(false);
    });
  });

  describe('Worker service', () => {
    it('should infer type as worker when container app has -worker suffix', async () => {
      rs.mocked(getContainerApp).mockResolvedValue({
        success: true,
        app: {
          exists: true,
          status: 'Succeeded',
          replicas: 2,
          image: 'myacr.azurecr.io/email-worker:latest',
        },
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'email-worker',
      });

      expect(result.containerApp).toBe(true);
      expect(result.inferredType).toBe('worker');
      expect(result.containerAppUrl).toBeUndefined();
    });
  });

  describe('Kong gateway', () => {
    it('should infer type as kong when service name is kong', async () => {
      rs.mocked(getContainerApp).mockResolvedValue({
        success: true,
        app: {
          exists: true,
          status: 'Succeeded',
          fqdn: 'myproject-kong.azurecontainerapps.io',
          replicas: 1,
          image: 'kong:3.4',
        },
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'kong',
      });

      expect(result.containerApp).toBe(true);
      expect(result.inferredType).toBe('kong');
    });
  });

  describe('Next.js frontend', () => {
    it('should infer type as nextjs when service name is frontend', async () => {
      rs.mocked(getContainerApp).mockResolvedValue({
        success: true,
        app: {
          exists: true,
          status: 'Succeeded',
          fqdn: 'myproject-frontend.azurecontainerapps.io',
          replicas: 1,
          image: 'myacr.azurecr.io/frontend:latest',
        },
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'frontend',
      });

      expect(result.containerApp).toBe(true);
      expect(result.inferredType).toBe('nextjs');
    });
  });

  describe('SPA service', () => {
    it('should infer type as spa when only storage account exists', async () => {
      rs.mocked(storageAccountExists).mockResolvedValue({ exists: true });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'dashboard',
      });

      expect(result.containerApp).toBe(false);
      expect(result.spaBucket).toBe(true);
      expect(result.inferredType).toBe('spa');
      expect(result.containerAppStatus).toBeUndefined();
      expect(result.containerAppUrl).toBeUndefined();
      expect(result.containerAppReplicas).toBeUndefined();
      expect(result.containerAppImage).toBeUndefined();
    });
  });

  describe('Unknown service', () => {
    it('should infer type as unknown when no resources are found', async () => {
      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'nonexistent',
      });

      expect(result.containerApp).toBe(false);
      expect(result.spaBucket).toBe(false);
      expect(result.inferredType).toBe('unknown');
      expect(result.secrets).toEqual([]);
      expect(result.hasDatabase).toBe(false);
    });
  });

  describe('Type inference logic', () => {
    it('should prioritize container app over storage account for type inference', async () => {
      rs.mocked(getContainerApp).mockResolvedValue({
        success: true,
        app: {
          exists: true,
          status: 'Succeeded',
          fqdn: 'myproject-frontend.azurecontainerapps.io',
          replicas: 1,
          image: 'myacr.azurecr.io/frontend:latest',
        },
      });
      rs.mocked(storageAccountExists).mockResolvedValue({ exists: true });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'frontend',
      });

      expect(result.containerApp).toBe(true);
      expect(result.spaBucket).toBe(true);
      expect(result.inferredType).toBe('nextjs');
    });

    it('should detect hasDatabase from databaseExists call', async () => {
      rs.mocked(databaseExists).mockResolvedValue({ exists: true });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'svc',
      });

      expect(result.hasDatabase).toBe(true);
    });

    it('should return empty secrets array when key vault query fails', async () => {
      rs.mocked(listKeyVaultSecretsByPrefix).mockResolvedValue({
        success: false,
        secrets: [],
        error: 'Vault not found',
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'svc',
      });

      expect(result.secrets).toEqual([]);
    });
  });

  describe('Resource naming', () => {
    it('should pass correct resource names to discovery functions', async () => {
      await discoverServiceResources({
        ...baseOptions,
        serviceName: 'auth-service',
      });

      expect(getContainerApp).toHaveBeenCalledWith({
        credentials: testCredentials,
        resourceGroupName: 'myproject-dev-rg',
        containerAppName: 'myproject-auth-service',
      });

      expect(storageAccountExists).toHaveBeenCalledWith({
        credentials: testCredentials,
        resourceGroupName: 'myproject-dev-rg',
        storageAccountName: 'myprojectdevauthservicespa',
      });

      expect(listKeyVaultSecretsByPrefix).toHaveBeenCalledWith({
        credentials: testCredentials,
        vaultName: 'myproject-dev-kv',
        prefix: 'myproject-auth-service-',
      });

      expect(databaseExists).toHaveBeenCalledWith({
        databaseName: 'auth-service',
        serverName: 'myproject-dev-postgres',
        resourceGroupName: 'myproject-dev-rg',
        credentials: testCredentials,
      });
    });

    it('should sanitize SPA bucket name to alphanumeric only', async () => {
      await discoverServiceResources({
        projectName: 'my-project',
        targetEnv: 'dev',
        serviceName: 'my-dashboard',
        credentials: testCredentials,
      });

      expect(storageAccountExists).toHaveBeenCalledWith(
        expect.objectContaining({
          storageAccountName: 'myprojectdevmydashboardspa',
        }),
      );
    });
  });

  describe('PostgreSQL server name', () => {
    it('should use the default server name and return it', async () => {
      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'auth-service',
      });

      expect(databaseExists).toHaveBeenCalledWith(
        expect.objectContaining({ serverName: 'myproject-dev-postgres' }),
      );
      expect(result.postgresServerName).toBe('myproject-dev-postgres');
    });

    it('should use database.serverName from infrastructure.json when set', async () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1.0.0',
        dev: { database: { serverName: 'myproject-dev-pg-2' } },
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'auth-service',
      });

      expect(databaseExists).toHaveBeenCalledWith({
        databaseName: 'auth-service',
        serverName: 'myproject-dev-pg-2',
        resourceGroupName: 'myproject-dev-rg',
        credentials: testCredentials,
      });
      expect(result.postgresServerName).toBe('myproject-dev-pg-2');
    });

    it('should ignore an override for another environment', async () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1.0.0',
        prod: { database: { serverName: 'myproject-prod-pg-2' } },
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'auth-service',
      });

      expect(result.postgresServerName).toBe('myproject-dev-postgres');
    });

    it('should reject an invalid override before calling Azure', async () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1.0.0',
        dev: { database: { serverName: 'Bad_Name' } },
      });

      await expect(
        discoverServiceResources({
          ...baseOptions,
          serviceName: 'auth-service',
        }),
      ).rejects.toThrow(mocks.CliError);
      expect(databaseExists).not.toHaveBeenCalled();
    });
  });
  describe('Key Vault secrets', () => {
    it("should list the service's secrets in its own vault and in the shared vault", async () => {
      rs.mocked(listKeyVaultSecretsByPrefix).mockImplementation(
        async ({ vaultName }) => ({
          success: true,
          secrets:
            vaultName === 'myproject-dev-kv'
              ? ['myproject-api-DATABASE-URL']
              : ['myproject-api-ADMIN-EMAILS'],
        }),
      );

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'api',
      });

      expect(listKeyVaultSecretsByPrefix).toHaveBeenCalledWith(
        expect.objectContaining({
          vaultName: 'myproject-dev-api',
          prefix: 'myproject-api-',
        }),
      );
      expect(result.secrets).toEqual(['myproject-api-DATABASE-URL']);
      expect(result.serviceVaultSecrets).toEqual([
        'myproject-api-ADMIN-EMAILS',
      ]);
    });

    it('should report no service vault secrets when the vault does not exist', async () => {
      rs.mocked(listKeyVaultSecretsByPrefix).mockImplementation(
        async ({ vaultName }) =>
          vaultName === 'myproject-dev-kv'
            ? { success: true, secrets: [] }
            : { success: false, secrets: [], error: 'getaddrinfo ENOTFOUND' },
      );

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'api',
      });

      expect(result.serviceVaultSecrets).toEqual([]);
    });
  });
});
