import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const mockBuildSecretName = rs.fn();

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    buildSecretName: (...args: unknown[]) => mockBuildSecretName(...args),
  })),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockFs = {
  existsSync: rs.fn(),
};
rs.mock('node:fs', () => ({
  default: {
    existsSync: (path: string) => mockFs.existsSync(path),
  },
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

const mockGetTerraformOutput = rs.fn();
const mockGetTerraformOutputJson = rs.fn();
rs.mock('../utils/gcp/terraform', () => ({
  getTerraformOutput: (...args: unknown[]) => mockGetTerraformOutput(...args),
  getTerraformOutputJson: (...args: unknown[]) =>
    mockGetTerraformOutputJson(...args),
}));

const mockAzureGetTerraformOutput = rs.fn();
const mockGetAcrIdentityOutputs = rs.fn();
const mockGetServiceSecretsIdentities = rs.fn(
  (): Record<string, { id: string; client_id: string }> => ({
    'auth-service': {
      id: '/identities/auth',
      client_id: 'auth-secrets-client',
    },
    'offers-service': {
      id: '/identities/offers',
      client_id: 'offers-secrets-client',
    },
  }),
);
rs.mock('../utils/azure/terraform', () => ({
  getTerraformOutput: (...args: unknown[]) =>
    mockAzureGetTerraformOutput(...args),
  getAcrIdentityOutputs: (...args: unknown[]) =>
    mockGetAcrIdentityOutputs(...args),
  getServiceSecretsIdentities: () => mockGetServiceSecretsIdentities(),
}));

rs.mock('../utils/build-runtime', () => ({
  buildRuntime: () => ({}),
}));

const mockGetGitSha = rs.fn();
rs.mock('../utils/docker', () => ({
  getGitSha: () => mockGetGitSha(),
}));

const mockBuildBackendEnvVars = rs.fn();
const mockBuildBackendSecrets = rs.fn();
const mockBuildGcpTerraformEnv = rs.fn();
const mockBuildAzureTerraformEnv = rs.fn();
const mockCalculatePoolSize = rs.fn();
const mockDeployCloudRunService = rs.fn();
const mockGetTotalWorkerMaxInstances = rs.fn();
const mockWaitForImage = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildBackendEnvVars: (...args: unknown[]) => mockBuildBackendEnvVars(...args),
  buildBackendSecrets: (...args: unknown[]) => mockBuildBackendSecrets(...args),
  buildGcpTerraformEnv: (...args: unknown[]) =>
    mockBuildGcpTerraformEnv(...args),
  buildAzureTerraformEnv: (...args: unknown[]) =>
    mockBuildAzureTerraformEnv(...args),
  calculatePoolSize: (...args: unknown[]) => mockCalculatePoolSize(...args),
  deployCloudRunService: (...args: unknown[]) =>
    mockDeployCloudRunService(...args),
  getTotalWorkerMaxInstances: (...args: unknown[]) =>
    mockGetTotalWorkerMaxInstances(...args),
  waitForImage: (...args: unknown[]) => mockWaitForImage(...args),
}));

const mockGetTotalServiceMaxInstances = rs.fn();
rs.mock('../utils/deploy/get-total-service-max-instances', () => ({
  getTotalServiceMaxInstances: (...args: unknown[]) =>
    mockGetTotalServiceMaxInstances(...args),
}));

const mockLoadInfrastructureConfig = rs.fn();
rs.mock('../utils/infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: (...args: unknown[]) =>
    mockLoadInfrastructureConfig(...args),
}));

const mockGetServiceConfig = rs.fn();
rs.mock('../utils/infrastructure/merge-with-defaults', () => ({
  getServiceConfig: (...args: unknown[]) => mockGetServiceConfig(...args),
}));

const mockAzureDeployWorker = rs.fn();
const mockBuildAzureBackendEnv = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureDeployWorker: (...args: unknown[]) => mockAzureDeployWorker(...args),
  buildAzureBackendEnv: (...args: unknown[]) =>
    mockBuildAzureBackendEnv(...args),
}));

import { infraWorkerDeploy } from './infra-worker-deploy';

describe('infraWorkerDeploy', () => {
  const mockCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'gcp' as const,
    targetEnv: 'prod',
    credentials: mockCredentials,
    runningInCI: false,
  };

  const azureCredentials = {
    subscriptionId: 'sub-123',
    tenantId: 'tenant-456',
    clientId: 'client-789',
    clientSecret: 'secret-abc',
    location: 'eastus',
  };

  const mockAzureContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'azure' as const,
    targetEnv: 'prod',
    credentials: azureCredentials,
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockFs.existsSync.mockReturnValue(true);
    mockBuildGcpTerraformEnv.mockReturnValue({
      GOOGLE_PROJECT: 'gcp-project-123',
    });
    mockBuildAzureTerraformEnv.mockReturnValue({
      ARM_SUBSCRIPTION_ID: 'sub-123',
    });
    mockAzureGetTerraformOutput.mockReturnValue('');
    mockGetAcrIdentityOutputs.mockReturnValue({
      acrManagedIdentityId: undefined,
      managedIdentityClientId: undefined,
    });
    mockGetTerraformOutput.mockImplementation((_dir: string, name: string) => {
      if (name === 'artifact_registry_url')
        return 'us-central1-docker.pkg.dev/gcp-project-123/my-app';
      if (name === 'vpc_id')
        return 'projects/gcp-project-123/global/networks/vpc';
      if (name === 'subnet_id')
        return 'projects/gcp-project-123/regions/us-central1/subnetworks/subnet';
      return '';
    });
    mockGetTerraformOutputJson.mockReturnValue({
      'auth-service': 'auth-sa@gcp-project-123.iam.gserviceaccount.com',
    });
    mockGetGitSha.mockReturnValue('abc123');
    mockWaitForImage.mockResolvedValue(undefined);
    mockDeployCloudRunService.mockResolvedValue({ success: true });
    mockAzureDeployWorker.mockResolvedValue(undefined);
    mockBuildAzureBackendEnv.mockReturnValue({
      envVars: [{ name: 'NODE_ENV', value: 'production' }],
      secrets: [{ name: 'azure-client-secret', value: 'secret-abc' }],
      secretEnvVars: [
        { name: 'AZURE_CLIENT_SECRET', secretRef: 'azure-client-secret' },
      ],
    });
    mockBuildBackendEnvVars.mockReturnValue({ NODE_ENV: 'production' });
    mockBuildBackendSecrets.mockReturnValue([
      { name: 'DATABASE_URL', secret: 'db-secret' },
    ]);
    mockLoadInfrastructureConfig.mockReturnValue(null);
    mockGetServiceConfig.mockReturnValue({
      minInstances: 1,
      maxInstances: 3,
      cpu: '1',
      memory: '512Mi',
      timeout: '540s',
      port: 3000,
      concurrency: 80,
    });
    mockCalculatePoolSize.mockReturnValue({
      poolMax: 2,
      dbConnections: 25,
      totalUsable: 22,
      totalInstances: 6,
    });
    mockGetTotalWorkerMaxInstances.mockReturnValue(3);
    mockGetTotalServiceMaxInstances.mockReturnValue(6);
    mockBuildSecretName.mockReturnValue('my-app-shared-KEY');
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
      ],
    });
  });

  describe('validation', () => {
    it('should throw when worker not found in config', async () => {
      await expect(
        infraWorkerDeploy({
          worker: 'unknown-worker',
          baseService: 'auth-service',
        }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when base service not found', async () => {
      await expect(
        infraWorkerDeploy({
          worker: 'auth-worker',
          baseService: 'unknown-service',
        }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw when terraform directory not found', async () => {
      mockFs.existsSync.mockReturnValue(false);

      await expect(
        infraWorkerDeploy({
          worker: 'auth-worker',
          baseService: 'auth-service',
        }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('image verification', () => {
    it('should verify base service image exists', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mockWaitForImage).toHaveBeenCalledWith(expect.anything(), {
        imageUri: expect.stringContaining('auth-service:abc123'),
        credentials: mockCredentials,
      });
    });

    it('should use custom tag when provided', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
        tag: 'v1.0.0',
      });

      expect(mockWaitForImage).toHaveBeenCalledWith(expect.anything(), {
        imageUri: expect.stringContaining('auth-service:v1.0.0'),
        credentials: mockCredentials,
      });
    });
  });

  describe('Cloud Run deployment', () => {
    it('should deploy with worker-specific settings', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mockDeployCloudRunService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          serviceName: 'auth-worker',
          command: ['node', 'dist/worker.js'],
          cpuIdle: false,
          minInstances: 1,
          ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY',
        }),
      );
    });

    it('should use base service service account', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mockDeployCloudRunService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          serviceAccount: 'auth-sa@gcp-project-123.iam.gserviceaccount.com',
        }),
      );
    });

    it('should use VPC network', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mockDeployCloudRunService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          vpcNetwork: expect.stringContaining('vpc'),
          vpcSubnet: expect.stringContaining('subnet'),
        }),
      );
    });
  });

  describe('logging', () => {
    it('should log deployment info', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Worker: auth-worker'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Base service: auth-service'),
      );
    });

    it('should log completion', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        expect.stringContaining('deployed successfully'),
      );
    });
  });

  describe('Azure provider routing', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);
    });

    it('should call azureDeployWorker for Azure provider', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mockAzureDeployWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          projectRoot: '/test/project',
          projectName: 'my-app',
          targetEnv: 'prod',
          credentials: azureCredentials,
          imageTag: 'abc123',
        }),
      );
      expect(mockDeployCloudRunService).not.toHaveBeenCalled();
    });

    it("should deploy with the base service's Key Vault identity", async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mockAzureDeployWorker).toHaveBeenCalledWith(
        expect.objectContaining({ secretsIdentityId: '/identities/auth' }),
      );
    });

    it('should fail when the base service has no Key Vault identity', async () => {
      mockGetServiceSecretsIdentities.mockReturnValueOnce({});

      await expect(
        infraWorkerDeploy({
          worker: 'auth-worker',
          baseService: 'auth-service',
        }),
      ).rejects.toThrow('No Key Vault identity for auth-service');
      expect(mockAzureDeployWorker).not.toHaveBeenCalled();
    });

    it('should pass worker and baseService objects from config', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
      });

      expect(mockAzureDeployWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          worker: {
            name: 'auth-worker',
            type: 'worker',
            baseService: 'auth-service',
          },
          baseService: {
            name: 'auth-service',
            type: 'nestjs',
            hasDatabase: true,
          },
        }),
      );
    });

    it('should use custom tag when provided', async () => {
      await infraWorkerDeploy({
        worker: 'auth-worker',
        baseService: 'auth-service',
        tag: 'v1.0.0',
      });

      expect(mockAzureDeployWorker).toHaveBeenCalledWith(
        expect.objectContaining({
          imageTag: 'v1.0.0',
        }),
      );
    });
  });
});
