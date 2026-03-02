import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockRegister = rs.fn();

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

rs.mock('@azure/arm-resources', () => ({
  ResourceManagementClient: class MockResourceManagementClient {
    providers = {
      register: mockRegister,
    };
    constructor() {}
  },
}));

import { registerInfraProviders } from './register-infra-providers';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';

const mockCredentials: AzureCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-sub-id',
  location: 'eastus',
};

describe('registerInfraProviders', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should register all required providers', async () => {
    mockRegister.mockResolvedValue({});

    const result = await registerInfraProviders(mockCredentials);

    expect(result.success).toBe(true);
    expect(result.registered.length).toBe(11);
    expect(result.registered).toContain('Microsoft.ContainerRegistry');
    expect(result.registered).toContain('Microsoft.App');
    expect(result.registered).toContain('Microsoft.Web');
    expect(result.registered).toContain('Microsoft.Storage');
    expect(result.registered).toContain('Microsoft.KeyVault');
  });

  it('should return error when registration fails', async () => {
    mockRegister.mockResolvedValueOnce({});
    mockRegister.mockRejectedValueOnce(new Error('Access denied'));

    const result = await registerInfraProviders(mockCredentials);

    expect(result.success).toBe(false);
    expect(result.registered.length).toBe(1);
    expect(result.error).toBe('Access denied');
  });
});
