import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

const mockEnableRequiredApis = rs.fn();
rs.mock('../utils/gcp/bootstrap/enable-required-apis', () => ({
  enableRequiredApis: (...args: unknown[]) => mockEnableRequiredApis(...args),
}));

const mockUpgradeSelfPermissions = rs.fn();
rs.mock('../utils/gcp/bootstrap/upgrade-self-permissions', () => ({
  upgradeSelfPermissions: (...args: unknown[]) =>
    mockUpgradeSelfPermissions(...args),
}));

const mockAwsBootstrap = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  awsBootstrap: (...args: unknown[]) => mockAwsBootstrap(...args),
}));

import { infraBootstrap } from './infra-bootstrap';

describe('infraBootstrap', () => {
  const mockGCPCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: 'key',
  };

  const mockAWSCredentials = {
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    accountId: '123456789012',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'gcp' as const,
    targetEnv: 'prod',
    credentials: mockGCPCredentials,
    runningInCI: false,
  };

  const mockAWSContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'aws' as const,
    targetEnv: 'prod',
    credentials: mockAWSCredentials,
    runningInCI: false,
  };

  const mockAzureContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'azure' as const,
    targetEnv: 'prod',
    credentials: { subscriptionId: 'sub-123', tenantId: 'tenant-123' },
    runningInCI: false,
  };

  const mockUnsupportedContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'unknown' as const,
    targetEnv: 'prod',
    credentials: {},
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockEnableRequiredApis.mockResolvedValue(undefined);
    mockUpgradeSelfPermissions.mockResolvedValue(undefined);
    mockAwsBootstrap.mockResolvedValue(undefined);
  });

  describe('GCP provider', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    });

    it('should enable required APIs', async () => {
      await infraBootstrap({});

      expect(mockEnableRequiredApis).toHaveBeenCalledWith(mockGCPContext);
    });

    it('should upgrade self permissions', async () => {
      await infraBootstrap({});

      expect(mockUpgradeSelfPermissions).toHaveBeenCalledWith(mockGCPContext);
    });

    it('should run both steps in order', async () => {
      const callOrder: string[] = [];
      mockEnableRequiredApis.mockImplementation(() => {
        callOrder.push('enableApis');
        return Promise.resolve();
      });
      mockUpgradeSelfPermissions.mockImplementation(() => {
        callOrder.push('upgradePermissions');
        return Promise.resolve();
      });

      await infraBootstrap({});

      expect(callOrder).toEqual(['enableApis', 'upgradePermissions']);
    });

    it('should not call AWS bootstrap', async () => {
      await infraBootstrap({});

      expect(mockAwsBootstrap).not.toHaveBeenCalled();
    });

    it('should log GCP bootstrap messages', async () => {
      await infraBootstrap({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Bootstrapping GCP'),
      );
      expect(mocks.logger.complete).toHaveBeenCalledWith(
        expect.stringContaining('Bootstrap complete'),
      );
    });
  });

  describe('AWS provider', () => {
    beforeEach(() => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);
    });

    it('should call AWS bootstrap', async () => {
      await infraBootstrap({});

      expect(mockAwsBootstrap).toHaveBeenCalledWith(mockAWSContext);
    });

    it('should not call GCP bootstrap functions', async () => {
      await infraBootstrap({});

      expect(mockEnableRequiredApis).not.toHaveBeenCalled();
      expect(mockUpgradeSelfPermissions).not.toHaveBeenCalled();
    });

    it('should log AWS bootstrap messages', async () => {
      await infraBootstrap({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Bootstrapping AWS'),
      );
    });
  });

  describe('environment option', () => {
    it('should pass env option to setupInfraCommand', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockGCPContext);

      await infraBootstrap({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:bootstrap',
      );
    });
  });

  describe('Azure provider', () => {
    it('should throw not implemented error', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAzureContext);

      await expect(infraBootstrap({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('unsupported provider', () => {
    it('should throw unsupported provider error', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockUnsupportedContext);

      await expect(infraBootstrap({})).rejects.toThrow(mocks.CliError);
    });
  });
});
