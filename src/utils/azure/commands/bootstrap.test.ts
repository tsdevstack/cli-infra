import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../bootstrap/register-infra-providers', () => ({
  registerInfraProviders: rs.fn(),
}));

rs.mock('../bootstrap/create-state-backend', () => ({
  createStateBackend: rs.fn(),
}));

import { azureBootstrap } from './bootstrap';
import { registerInfraProviders } from '../bootstrap/register-infra-providers';
import { createStateBackend } from '../bootstrap/create-state-backend';

describe('azureBootstrap', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      clientId: 'test-client-id',
      clientSecret: 'test-secret',
      tenantId: 'test-tenant-id',
      subscriptionId: 'test-sub-id',
      location: 'eastus',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should register providers and create state backend', async () => {
    rs.mocked(registerInfraProviders).mockResolvedValue({
      success: true,
      registered: ['Microsoft.App', 'Microsoft.Storage'],
    });
    rs.mocked(createStateBackend).mockResolvedValue({
      success: true,
      storageAccountName: 'myappdevtfstate',
      containerName: 'tfstate',
      storageAccountCreated: true,
      containerCreated: true,
    });

    await azureBootstrap(mockCtx);

    expect(registerInfraProviders).toHaveBeenCalledWith(mockCtx.credentials);
    expect(createStateBackend).toHaveBeenCalledWith({
      projectName: 'my-app',
      env: 'dev',
      credentials: mockCtx.credentials,
    });
    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Created Storage Account: myappdevtfstate',
    );
    expect(mocks.logger.complete).toHaveBeenCalledWith('Bootstrap complete!');
  });

  it('should show existing resources message when already present', async () => {
    rs.mocked(registerInfraProviders).mockResolvedValue({
      success: true,
      registered: ['Microsoft.App'],
    });
    rs.mocked(createStateBackend).mockResolvedValue({
      success: true,
      storageAccountName: 'myappdevtfstate',
      containerName: 'tfstate',
      storageAccountCreated: false,
      containerCreated: false,
    });

    await azureBootstrap(mockCtx);

    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Storage Account already exists: myappdevtfstate',
    );
    expect(mocks.logger.success).toHaveBeenCalledWith(
      'Blob Container already exists: tfstate',
    );
  });

  it('should throw when provider registration fails', async () => {
    rs.mocked(registerInfraProviders).mockResolvedValue({
      success: false,
      registered: [],
      error: 'Access denied',
    });

    await expect(azureBootstrap(mockCtx)).rejects.toThrow(mocks.CliError);
  });

  it('should throw when state backend creation fails', async () => {
    rs.mocked(registerInfraProviders).mockResolvedValue({
      success: true,
      registered: ['Microsoft.App'],
    });
    rs.mocked(createStateBackend).mockResolvedValue({
      success: false,
      storageAccountName: 'myappdevtfstate',
      containerName: 'tfstate',
      storageAccountCreated: false,
      containerCreated: false,
      error: 'RG not found',
    });

    await expect(azureBootstrap(mockCtx)).rejects.toThrow(mocks.CliError);
  });
});
