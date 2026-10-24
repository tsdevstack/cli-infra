import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

// Get the base mock context
const baseMocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

// Extend with additional functions used by setupInfraCommand
const isCIEnv = rs.fn();
const resolveEnvironment = rs.fn();
const getGCPCredentialsFromEnv = rs.fn();
const getAWSCredentialsFromEnv = rs.fn();
const getAzureCredentialsFromEnv = rs.fn();

const mocks = {
  ...baseMocks,
  isCIEnv,
  resolveEnvironment,
  getGCPCredentialsFromEnv,
  getAWSCredentialsFromEnv,
  getAzureCredentialsFromEnv,
};

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => mocks),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

rs.mock('../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(),
}));

rs.mock('../infrastructure/validate-infrastructure-config', () => ({
  validateInfrastructureConfig: rs.fn(),
}));

import { setupInfraCommand } from './setup-infra-command';
import { loadInfrastructureConfig } from '../infrastructure/load-infrastructure-config';
import { validateInfrastructureConfig } from '../infrastructure/validate-infrastructure-config';

describe('setupInfraCommand', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('provider validation', () => {
    it('should throw when no cloud provider is configured', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: null },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(false);

      await expect(setupInfraCommand({}, 'infra:deploy')).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when provider is not supported', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'digitalocean' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(false);

      await expect(setupInfraCommand({}, 'infra:deploy')).rejects.toThrow(
        mocks.CliError,
      );
    });
  });

  describe('CI environment', () => {
    it('should use environment credentials from env vars in CI', async () => {
      const mockCredentials = {
        project_id: 'ci-project',
        region: 'us-central1',
        client_email: 'ci@test.iam.gserviceaccount.com',
        private_key: 'key',
      };

      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'gcp' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(true);
      mocks.resolveEnvironment.mockResolvedValue('prod');
      mocks.getGCPCredentialsFromEnv.mockReturnValue(mockCredentials);

      const result = await setupInfraCommand({ env: 'prod' }, 'infra:deploy');

      expect(result.runningInCI).toBe(true);
      expect(result.credentials).toEqual(mockCredentials);
      expect(result.targetEnv).toBe('prod');
      expect(mocks.getGCPCredentialsFromEnv).toHaveBeenCalled();
    });
  });

  describe('local environment', () => {
    it('should load credentials from file', async () => {
      const mockCredentials = {
        project_id: 'local-project',
        region: 'us-east1',
        client_email: 'local@test.iam.gserviceaccount.com',
        private_key: 'key',
      };

      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'gcp' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(false);
      mocks.loadCredentialsFile.mockReturnValue({ dev: mockCredentials });
      mocks.getAvailableEnvironments.mockReturnValue([
        'dev',
        'staging',
        'prod',
      ]);
      mocks.resolveEnvironment.mockResolvedValue('dev');

      const result = await setupInfraCommand({}, 'infra:deploy');

      expect(result.runningInCI).toBe(false);
      expect(result.credentials).toEqual(mockCredentials);
      expect(result.targetEnv).toBe('dev');
      expect(result.projectName).toBe('test-project');
      expect(result.provider).toBe('gcp');
    });

    it('should throw when credentials file not found', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'gcp' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(false);
      mocks.loadCredentialsFile.mockImplementation(() => {
        throw new Error('File not found');
      });

      await expect(setupInfraCommand({}, 'infra:deploy')).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when no environments configured', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'gcp' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(false);
      mocks.loadCredentialsFile.mockReturnValue({});
      mocks.getAvailableEnvironments.mockReturnValue([]);

      await expect(setupInfraCommand({}, 'infra:deploy')).rejects.toThrow(
        mocks.CliError,
      );
    });
  });

  describe('Azure provider', () => {
    it('should load Azure credentials from env in CI', async () => {
      const mockCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        tenantId: 'test-tenant-id',
        subscriptionId: 'test-sub-id',
        location: 'eastus',
      };

      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'azure' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(true);
      mocks.resolveEnvironment.mockResolvedValue('prod');
      mocks.getAzureCredentialsFromEnv.mockReturnValue(mockCredentials);

      const result = await setupInfraCommand({ env: 'prod' }, 'infra:deploy');

      expect(result.runningInCI).toBe(true);
      expect(result.credentials).toEqual(mockCredentials);
      expect(result.provider).toBe('azure');
      expect(mocks.getAzureCredentialsFromEnv).toHaveBeenCalled();
    });

    it('should load Azure credentials from file locally', async () => {
      const mockCredentials = {
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        tenantId: 'test-tenant-id',
        subscriptionId: 'test-sub-id',
        location: 'eastus',
      };

      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'azure' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(false);
      mocks.loadCredentialsFile.mockReturnValue({ dev: mockCredentials });
      mocks.getAvailableEnvironments.mockReturnValue(['dev']);
      mocks.resolveEnvironment.mockResolvedValue('dev');

      const result = await setupInfraCommand({}, 'infra:deploy');

      expect(result.runningInCI).toBe(false);
      expect(result.credentials).toEqual(mockCredentials);
      expect(result.provider).toBe('azure');
      expect(result.targetEnv).toBe('dev');
    });
  });

  describe('infrastructure.json validation', () => {
    const infraConfig = { version: '1.0.0', dev: {} };

    beforeEach(() => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'test-project' },
        cloud: { provider: 'gcp' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/test/project');
      mocks.isCIEnv.mockReturnValue(false);
      mocks.loadCredentialsFile.mockReturnValue({ dev: { project_id: 'p' } });
      mocks.getAvailableEnvironments.mockReturnValue(['dev']);
      mocks.resolveEnvironment.mockResolvedValue('dev');
      rs.mocked(loadInfrastructureConfig).mockReturnValue(
        infraConfig as ReturnType<typeof loadInfrastructureConfig>,
      );
    });

    it('should validate it for commands that build or deploy', async () => {
      await setupInfraCommand({}, 'infra:deploy');

      expect(validateInfrastructureConfig).toHaveBeenCalledWith(infraConfig);
    });

    it('should stop the command when it is invalid', async () => {
      rs.mocked(validateInfrastructureConfig).mockImplementationOnce(() => {
        throw new Error('Unknown service "old-service" in environment "dev"');
      });

      await expect(setupInfraCommand({}, 'infra:generate')).rejects.toThrow(
        'Unknown service "old-service"',
      );
    });

    it('should never block infra:destroy', async () => {
      await setupInfraCommand({}, 'infra:destroy');

      expect(validateInfrastructureConfig).not.toHaveBeenCalled();
    });

    it('should not validate for read-only commands', async () => {
      await setupInfraCommand({}, 'infra:service-status');

      expect(validateInfrastructureConfig).not.toHaveBeenCalled();
    });

    it('should do nothing without infrastructure.json (defaults)', async () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue(null);

      await setupInfraCommand({}, 'infra:deploy');

      expect(validateInfrastructureConfig).not.toHaveBeenCalled();
    });
  });

  describe('return value', () => {
    it('should return complete context object', async () => {
      const mockCredentials = {
        project_id: 'test-project-id',
        region: 'europe-west1',
        client_email: 'sa@test.iam.gserviceaccount.com',
        private_key: 'private-key',
      };

      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'gcp' },
        services: [],
      });
      mocks.findProjectRoot.mockReturnValue('/home/user/my-app');
      mocks.isCIEnv.mockReturnValue(false);
      mocks.loadCredentialsFile.mockReturnValue({ staging: mockCredentials });
      mocks.getAvailableEnvironments.mockReturnValue(['staging']);
      mocks.resolveEnvironment.mockResolvedValue('staging');

      const result = await setupInfraCommand({ env: 'staging' }, 'infra:plan');

      expect(result).toEqual({
        projectRoot: '/home/user/my-app',
        projectName: 'my-app',
        provider: 'gcp',
        targetEnv: 'staging',
        credentials: mockCredentials,
        runningInCI: false,
      });
    });
  });
});
