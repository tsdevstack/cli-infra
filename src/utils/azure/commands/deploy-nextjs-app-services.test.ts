/**
 * Tests for deploy-nextjs-app-services
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

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('./deploy-app-service', () => ({
  deployAppService: rs.fn(),
}));

rs.mock('./set-app-service-settings', () => ({
  setAppServiceSettings: rs.fn(),
}));

rs.mock('../../docker', () => ({
  getGitSha: rs.fn(() => 'abc1234'),
}));

rs.mock('../../credentials/fetch-secret', () => ({
  fetchSecret: rs.fn(),
}));

const mockConfigureAcrAuth = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildFrontendEnvVars: rs.fn(),
  buildFrontendSecrets: rs.fn(),
  configureAcrAuth: (...args: unknown[]) => mockConfigureAcrAuth(...args),
  parseServiceFilter: rs.fn((service?: string) =>
    service
      ? service
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : undefined,
  ),
  buildAzureTerraformEnv: rs.fn(),
}));

rs.mock('../../deploy/get-service-secret-keys', () => ({
  getServiceSecretKeys: rs.fn(),
}));

rs.mock('../../terraform', () => ({
  toTerraformId: rs.fn((name: string) => name.replace(/-/g, '_')),
}));

rs.mock('../../../commands/infra-docker-generate', () => ({
  infraDockerGenerate: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-build', () => ({
  infraDockerBuild: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-push', () => ({
  infraDockerPush: rs.fn(),
}));

import { deployNextjsAppServices } from './deploy-nextjs-app-services';
import { getTerraformOutput } from '../terraform';
import { deployAppService } from './deploy-app-service';
import { setAppServiceSettings } from './set-app-service-settings';
import { fetchSecret } from '../../credentials/fetch-secret';
import {
  buildFrontendEnvVars,
  buildFrontendSecrets,
  buildAzureTerraformEnv,
} from '@tsdevstack/infra-core';
import { getServiceSecretKeys } from '../../deploy/get-service-secret-keys';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';

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

describe('deployNextjsAppServices', () => {
  beforeEach(() => {
    rs.resetAllMocks();

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
        { name: 'landing', type: 'spa' },
      ],
    });

    mockConfigureAcrAuth.mockResolvedValue(undefined);
    rs.mocked(buildAzureTerraformEnv).mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
      ARM_TENANT_ID: 'tenant-456',
    });

    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        const outputs: Record<string, string> = {
          acr_login_server: 'myacr.azurecr.io',
          resource_group_name: 'my-app-dev-rg',
          nextjs_frontend_app_service_name: 'my-app-frontend-app',
          api_url: 'https://api.my-app.example.com',
        };
        return outputs[key] ?? '';
      },
    );

    rs.mocked(buildFrontendEnvVars).mockReturnValue({
      NODE_ENV: 'production',
    });
    rs.mocked(getServiceSecretKeys).mockReturnValue([]);
    rs.mocked(buildFrontendSecrets).mockReturnValue([
      {
        envVar: 'API_URL',
        secretName: 'my-app-shared-API-URL',
        version: 'latest',
      },
    ]);

    rs.mocked(fetchSecret).mockImplementation((key: string) => {
      if (key === 'API_URL') return 'https://api.example.com';
      return null;
    });
  });

  it('should deploy only nextjs services', async () => {
    await deployNextjsAppServices(mockCtx, {});

    // Only frontend (nextjs), not auth-service (nestjs) or landing (spa)
    expect(deployAppService).toHaveBeenCalledTimes(1);
  });

  it('should filter by specific service', async () => {
    await deployNextjsAppServices(mockCtx, { service: 'frontend' });

    expect(deployAppService).toHaveBeenCalledTimes(1);
  });

  it('should warn when no nextjs services found', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service', type: 'nestjs' }],
    });

    await deployNextjsAppServices(mockCtx, {});

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'No Next.js services found to deploy',
    );
    expect(deployAppService).not.toHaveBeenCalled();
  });

  it('should throw when terraform outputs fail', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(() => {
      throw new Error('no state');
    });

    await expect(deployNextjsAppServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });

  it('should generate Dockerfiles by default', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(infraDockerGenerate).toHaveBeenCalledWith({
      service: 'frontend',
    });
  });

  it('should skip Dockerfile generation when skipGenerate is true', async () => {
    await deployNextjsAppServices(mockCtx, { skipGenerate: true });

    expect(infraDockerGenerate).not.toHaveBeenCalled();
  });

  it('should authenticate Docker once and pass skipAuth to build and push', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(mockConfigureAcrAuth).toHaveBeenCalledTimes(1);
    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
    expect(infraDockerPush).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('should build Docker images', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        env: 'dev',
        service: 'frontend',
        tag: 'abc1234',
      }),
    );
  });

  it('should push Docker images', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(infraDockerPush).toHaveBeenCalledWith(
      expect.objectContaining({
        env: 'dev',
        service: 'frontend',
        tag: 'abc1234',
      }),
    );
  });

  it('should use custom tag when provided', async () => {
    await deployNextjsAppServices(mockCtx, { tag: 'v1.0.0' });

    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.0.0' }),
    );
    expect(infraDockerPush).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.0.0' }),
    );
  });

  it('should deploy to App Service with correct image', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(deployAppService).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceGroupName: 'my-app-dev-rg',
        appServiceName: 'my-app-frontend-app',
        acrLoginServer: 'myacr.azurecr.io',
        imageUri: 'myacr.azurecr.io/frontend:abc1234',
      }),
    );
  });

  it('should set frontend env vars as app settings', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(setAppServiceSettings).toHaveBeenCalledWith(
      mockCtx.credentials,
      'my-app-dev-rg',
      'my-app-frontend-app',
      expect.objectContaining({
        NODE_ENV: 'production',
      }),
    );
  });

  it('should inject frontend secrets that exist', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(setAppServiceSettings).toHaveBeenCalledWith(
      mockCtx.credentials,
      'my-app-dev-rg',
      'my-app-frontend-app',
      expect.objectContaining({
        API_URL: 'https://api.example.com',
      }),
    );
  });

  it('should warn when frontend secret not found', async () => {
    rs.mocked(buildFrontendSecrets).mockReturnValue([
      {
        envVar: 'MISSING_SECRET',
        secretName: 'my-app-shared-MISSING-SECRET',
        version: 'latest',
      },
    ]);

    await deployNextjsAppServices(mockCtx, {});

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      '  MISSING_SECRET not found in Key Vault',
    );
  });

  it('should fall back to Terraform api_url when API_URL not in Key Vault', async () => {
    rs.mocked(fetchSecret).mockReturnValue(null);

    await deployNextjsAppServices(mockCtx, {});

    expect(setAppServiceSettings).toHaveBeenCalledWith(
      mockCtx.credentials,
      'my-app-dev-rg',
      'my-app-frontend-app',
      expect.objectContaining({
        API_URL: 'https://api.my-app.example.com',
      }),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Injecting API_URL from Terraform'),
    );
  });

  it('should not override API_URL from Key Vault with Terraform fallback', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(setAppServiceSettings).toHaveBeenCalledWith(
      mockCtx.credentials,
      'my-app-dev-rg',
      'my-app-frontend-app',
      expect.objectContaining({
        API_URL: 'https://api.example.com',
      }),
    );
  });

  it('should get App Service name from Terraform output using tfId', async () => {
    await deployNextjsAppServices(mockCtx, {});

    expect(getTerraformOutput).toHaveBeenCalledWith(
      expect.stringContaining('terraform/dev'),
      'nextjs_frontend_app_service_name',
      expect.any(Object),
    );
  });

  it('should throw when App Service name Terraform output fails', async () => {
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        if (key === 'nextjs_frontend_app_service_name') {
          throw new Error('not found');
        }
        const outputs: Record<string, string> = {
          acr_login_server: 'myacr.azurecr.io',
          resource_group_name: 'my-app-dev-rg',
        };
        return outputs[key] ?? '';
      },
    );

    await expect(deployNextjsAppServices(mockCtx, {})).rejects.toThrow(
      mocks.CliError,
    );
  });
});
