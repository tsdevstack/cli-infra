/**
 * Tests for discover-deployed-services
 */

import { describe, it, expect, rs, beforeEach } from '@rstest/core';

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
rs.mock('@azure/arm-appservice', () => ({
  WebSiteManagementClient: class MockWebSiteManagementClient {
    constructor() {}
  },
}));

// Mock the individual discovery functions
rs.mock('./list-container-apps', { mock: true });
rs.mock('./list-app-services', { mock: true });
rs.mock('./list-spa-storage-accounts', { mock: true });

import { discoverDeployedServices } from './discover-deployed-services';
import { listContainerApps } from './list-container-apps';
import { listAppServices } from './list-app-services';
import { listSpaStorageAccounts } from './list-spa-storage-accounts';

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

describe('discoverDeployedServices', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    // Default: no App Services (most existing tests don't need them)
    rs.mocked(listAppServices).mockResolvedValue({
      success: true,
      apps: [],
    });
  });

  describe('Multiple services', () => {
    it('should return all container apps as services with correct types', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-auth-service',
            status: 'Succeeded',
            fqdn: 'myproject-auth-service.azurecontainerapps.io',
            image: 'myacr.azurecr.io/auth-service:v1',
          },
          {
            name: 'myproject-kong',
            status: 'Succeeded',
            fqdn: 'myproject-kong.azurecontainerapps.io',
            image: 'kong:3.4',
          },
          {
            name: 'myproject-frontend',
            status: 'Succeeded',
            fqdn: 'myproject-frontend.azurecontainerapps.io',
            image: 'myacr.azurecr.io/frontend:v1',
          },
          {
            name: 'myproject-email-worker',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/email-worker:v1',
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(4);

      const authService = result.services.find(
        (s) => s.name === 'auth-service',
      );
      expect(authService).toBeDefined();
      expect(authService!.type).toBe('backend');
      expect(authService!.status).toBe('Succeeded');
      expect(authService!.imageUri).toBe('myacr.azurecr.io/auth-service:v1');
      expect(authService!.resources.containerApp).toBe(true);

      const kong = result.services.find((s) => s.name === 'kong');
      expect(kong).toBeDefined();
      expect(kong!.type).toBe('kong');

      const frontend = result.services.find((s) => s.name === 'frontend');
      expect(frontend).toBeDefined();
      expect(frontend!.type).toBe('nextjs');

      const worker = result.services.find((s) => s.name === 'email-worker');
      expect(worker).toBeDefined();
      expect(worker!.type).toBe('worker');
    });

    it('should strip project prefix from container app names', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-offers-service',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/offers-service:v1',
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services[0].name).toBe('offers-service');
    });

    it('should use app name as-is when it does not start with project prefix', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'standalone-app',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/standalone:v1',
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services[0].name).toBe('standalone-app');
    });
  });

  describe('Empty environment', () => {
    it('should return empty services list when no resources exist', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toEqual([]);
    });
  });

  describe('SPAs mixed with container apps', () => {
    it('should add SPA-only services with type spa', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-auth-service',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/auth-service:v1',
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [{ name: 'myprojectdevdashboardspa', spaName: 'dashboard' }],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(2);

      const spa = result.services.find((s) => s.name === 'dashboard');
      expect(spa).toBeDefined();
      expect(spa!.type).toBe('spa');
      expect(spa!.status).toBe('Active');
      expect(spa!.imageUri).toBe('-');
      expect(spa!.resources.containerApp).toBe(false);
      expect(spa!.resources.spaBucket).toBe(true);
    });

    it('should mark spaBucket true on existing container app service when SPA matches', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-frontend',
            status: 'Succeeded',
            fqdn: 'myproject-frontend.azurecontainerapps.io',
            image: 'myacr.azurecr.io/frontend:v1',
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [{ name: 'myprojectdevfrontendspa', spaName: 'frontend' }],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services).toHaveLength(1);

      const frontend = result.services[0];
      expect(frontend.name).toBe('frontend');
      expect(frontend.type).toBe('nextjs');
      expect(frontend.resources.containerApp).toBe(true);
      expect(frontend.resources.spaBucket).toBe(true);
    });

    it('should handle SPA listing failure gracefully and still return container apps', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-auth-service',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/auth-service:v1',
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: false,
        accounts: [],
        error: 'Permission denied',
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(1);
      expect(result.services[0].name).toBe('auth-service');
    });
  });

  describe('Error handling', () => {
    it('should return failure when container apps listing fails', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: false,
        apps: [],
        error: 'Resource group not found',
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(false);
      expect(result.services).toEqual([]);
      expect(result.error).toBe('Resource group not found');
    });
  });

  describe('Resource naming', () => {
    it('should pass correct resource group name to discovery functions', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      await discoverDeployedServices(baseOptions);

      expect(listContainerApps).toHaveBeenCalledWith({
        credentials: testCredentials,
        resourceGroupName: 'myproject-dev-rg',
        projectName: 'myproject',
      });

      expect(listSpaStorageAccounts).toHaveBeenCalledWith({
        credentials: testCredentials,
        resourceGroupName: 'myproject-dev-rg',
        projectName: 'myproject',
        targetEnv: 'dev',
      });

      expect(listAppServices).toHaveBeenCalledWith({
        credentials: testCredentials,
        resourceGroupName: 'myproject-dev-rg',
        projectName: 'myproject',
      });
    });
  });

  describe('Image URI fallback', () => {
    it('should use unknown when container app has no image', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-auth-service',
            status: 'Succeeded',
            image: undefined,
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services[0].imageUri).toBe('unknown');
    });
  });

  describe('App Service discovery', () => {
    it('should discover App Service web apps with correct types', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-auth-service',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/auth-service:v1',
          },
        ],
      });
      rs.mocked(listAppServices).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-dev-kong',
            status: 'Running',
            image: 'myacr.azurecr.io/kong:v1',
          },
          {
            name: 'myproject-dev-frontend',
            status: 'Running',
            image: 'myacr.azurecr.io/frontend:v1',
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(3);

      const kong = result.services.find((s) => s.name === 'kong');
      expect(kong).toBeDefined();
      expect(kong!.type).toBe('kong');
      expect(kong!.resources.appService).toBe(true);
      expect(kong!.resources.containerApp).toBe(false);

      const frontend = result.services.find((s) => s.name === 'frontend');
      expect(frontend).toBeDefined();
      expect(frontend!.type).toBe('nextjs');
      expect(frontend!.resources.appService).toBe(true);
      expect(frontend!.resources.containerApp).toBe(false);
    });

    it('should skip App Service if already discovered as Container App', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-kong',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/kong:v1',
          },
        ],
      });
      rs.mocked(listAppServices).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-dev-kong',
            status: 'Running',
            image: 'myacr.azurecr.io/kong:v1',
          },
        ],
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.services).toHaveLength(1);
      expect(result.services[0].resources.containerApp).toBe(true);
    });

    it('should handle App Service listing failure gracefully', async () => {
      rs.mocked(listContainerApps).mockResolvedValue({
        success: true,
        apps: [
          {
            name: 'myproject-auth-service',
            status: 'Succeeded',
            image: 'myacr.azurecr.io/auth-service:v1',
          },
        ],
      });
      rs.mocked(listAppServices).mockResolvedValue({
        success: false,
        apps: [],
        error: 'Permission denied',
      });
      rs.mocked(listSpaStorageAccounts).mockResolvedValue({
        success: true,
        accounts: [],
      });

      const result = await discoverDeployedServices(baseOptions);

      expect(result.success).toBe(true);
      expect(result.services).toHaveLength(1);
      expect(result.services[0].name).toBe('auth-service');
    });
  });
});
