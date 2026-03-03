import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockRegister = rs.fn();
const mockGet = rs.fn();

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
      get: mockGet,
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

  it('should skip registration when all providers are already registered', async () => {
    mockGet.mockResolvedValue({ registrationState: 'Registered' });

    const result = await registerInfraProviders(mockCredentials);

    expect(result.success).toBe(true);
    expect(result.registered.length).toBe(12);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('should register only unregistered providers', async () => {
    for (let i = 0; i < 11; i++) {
      mockGet.mockResolvedValueOnce({ registrationState: 'Registered' });
    }
    mockGet.mockResolvedValueOnce({ registrationState: 'NotRegistered' });
    mockRegister.mockResolvedValue({});

    const result = await registerInfraProviders(mockCredentials);

    expect(result.success).toBe(true);
    expect(result.registered.length).toBe(12);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith('Microsoft.KeyVault');
  });

  it('should register all providers when none are registered', async () => {
    mockGet.mockResolvedValue({ registrationState: 'NotRegistered' });
    mockRegister.mockResolvedValue({});

    const result = await registerInfraProviders(mockCredentials);

    expect(result.success).toBe(true);
    expect(result.registered.length).toBe(12);
    expect(mockRegister).toHaveBeenCalledTimes(12);
  });

  it('should return permission error when authorization fails on register', async () => {
    mockGet.mockResolvedValue({ registrationState: 'NotRegistered' });
    mockRegister.mockRejectedValue(
      new Error('does not have authorization to perform action'),
    );

    const result = await registerInfraProviders(mockCredentials);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Insufficient permissions');
    expect(result.error).toContain('subscription-level Contributor');
  });

  it('should return error when registration fails with non-auth error', async () => {
    mockGet.mockResolvedValue({ registrationState: 'NotRegistered' });
    mockRegister.mockRejectedValue(new Error('Network error'));

    const result = await registerInfraProviders(mockCredentials);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('should return error when status check fails', async () => {
    mockGet.mockRejectedValue(new Error('Failed to get provider'));

    const result = await registerInfraProviders(mockCredentials);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to get provider');
  });
});
