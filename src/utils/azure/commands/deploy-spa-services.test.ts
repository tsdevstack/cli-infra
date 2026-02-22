import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(),
}));

rs.mock('../../deploy/fetch-service-secrets', () => ({
  fetchServiceSecrets: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: rs.fn(),
  uploadSpaToAzureStorage: rs.fn(),
  createAzureCredential: rs.fn(() => ({})),
  parseServiceFilter: rs.fn((service?: string) =>
    service
      ? service
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined,
  ),
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(() => true),
  },
}));

import { deploySpaServices } from './deploy-spa-services';
import { getTerraformOutput } from '../terraform';
import { execSync } from 'node:child_process';
import { fetchServiceSecrets } from '../../deploy/fetch-service-secrets';
import {
  uploadSpaToAzureStorage,
  buildAzureTerraformEnv,
} from '@tsdevstack/infra-core';
import fs from 'node:fs';

describe('deploySpaServices', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      subscriptionId: 'sub-123',
      tenantId: 'tenant-456',
      clientId: 'client-789',
      clientSecret: 'secret-abc',
      location: 'eastus',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'landing', type: 'spa' },
        { name: 'docs', type: 'spa' },
        { name: 'auth-service', type: 'nestjs' },
      ],
    });

    rs.mocked(buildAzureTerraformEnv).mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
      ARM_TENANT_ID: 'tenant-456',
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          resource_group_name: 'my-app-dev-rg',
          api_url: 'https://api.example.com',
          spa_landing_storage_account: 'myapplandingdev',
          spa_docs_storage_account: 'myappdocsdev',
        };
        return outputs[key] ?? '';
      },
    );

    rs.mocked(fetchServiceSecrets).mockReturnValue({
      API_URL: 'https://api.example.com',
      SOME_KEY: 'some-value',
    });

    rs.mocked(execSync).mockReturnValue(Buffer.from(''));
    rs.mocked(fs.existsSync).mockReturnValue(true);
    rs.mocked(uploadSpaToAzureStorage).mockResolvedValue({
      filesUploaded: 5,
      filesDeleted: 0,
    });
  });

  it('should deploy all SPA services', async () => {
    await deploySpaServices(mockCtx, {});

    // Build for each SPA service
    expect(execSync).toHaveBeenCalledTimes(2);
    // Upload for each SPA service
    expect(uploadSpaToAzureStorage).toHaveBeenCalledTimes(2);
  });

  it('should filter by specific service', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    // Only build for landing
    expect(execSync).toHaveBeenCalledTimes(1);
    // Only upload for landing
    expect(uploadSpaToAzureStorage).toHaveBeenCalledTimes(1);
  });

  it('should warn when no SPA services found', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service', type: 'nestjs' }],
    });

    await deploySpaServices(mockCtx, {});

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'No SPA services found to deploy',
    );
    expect(execSync).not.toHaveBeenCalled();
    expect(uploadSpaToAzureStorage).not.toHaveBeenCalled();
  });

  it('should build SPA with env vars from project root', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(execSync).toHaveBeenCalledWith('npm run build -w landing', {
      cwd: '/test/project',
      stdio: 'inherit',
      env: expect.objectContaining({
        API_URL: 'https://api.example.com',
        NODE_ENV: 'production',
        SOME_KEY: 'some-value',
      }),
    });
  });

  it('should get API_URL from cloud secrets via fetchServiceSecrets', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(fetchServiceSecrets).toHaveBeenCalledWith(
      'landing',
      expect.objectContaining({ services: expect.any(Array) }),
      'dev',
    );
  });

  it('should fetch service secrets per SPA', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(fetchServiceSecrets).toHaveBeenCalledWith(
      'landing',
      expect.objectContaining({ services: expect.any(Array) }),
      'dev',
    );
  });

  it('should upload to correct storage account', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(uploadSpaToAzureStorage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        storageAccountName: 'myapplandingdev',
      }),
    );
  });

  it('should upload from dist directory when it exists', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(uploadSpaToAzureStorage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        sourceDir: '/test/project/apps/landing/dist',
      }),
    );
  });

  it('should upload from build directory when dist does not exist', async () => {
    rs.mocked(fs.existsSync).mockImplementation((p) => {
      if (String(p).endsWith('/dist')) return false;
      if (String(p).endsWith('/build')) return true;
      return false;
    });

    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(uploadSpaToAzureStorage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        sourceDir: '/test/project/apps/landing/build',
      }),
    );
  });

  it('should pass credential to upload helper', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(uploadSpaToAzureStorage).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        subscriptionId: mockCtx.credentials.subscriptionId,
        credential: {},
      }),
    );
  });

  it('should throw when resource_group_name terraform output fails', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(
      deploySpaServices(mockCtx, { service: 'landing' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when storage account terraform output fails', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        if (key === 'resource_group_name') return 'my-app-dev-rg';
        throw new Error('no state');
      },
    );

    await expect(
      deploySpaServices(mockCtx, { service: 'landing' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when build fails', async () => {
    rs.mocked(execSync).mockImplementationOnce(() => {
      throw new Error('build failed');
    });

    await expect(
      deploySpaServices(mockCtx, { service: 'landing' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when upload fails', async () => {
    rs.mocked(uploadSpaToAzureStorage).mockRejectedValue(
      new Error('upload failed'),
    );

    await expect(
      deploySpaServices(mockCtx, { service: 'landing' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should throw when no build output directory exists', async () => {
    rs.mocked(fs.existsSync).mockReturnValue(false);

    await expect(
      deploySpaServices(mockCtx, { service: 'landing' }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should transform service name hyphens to underscores for terraform output key', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'my-landing-page', type: 'spa' }],
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        if (key === 'resource_group_name') return 'my-app-dev-rg';
        return 'mylandingdev';
      },
    );

    await deploySpaServices(mockCtx, {});

    expect(getTerraformOutput).toHaveBeenCalledWith(
      expect.anything(),
      'spa_my_landing_page_storage_account',
      expect.anything(),
    );
  });

  it('should log success for each deployed SPA', async () => {
    await deploySpaServices(mockCtx, { service: 'landing' });

    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('landing deployed to Blob Storage'),
    );
  });
});
