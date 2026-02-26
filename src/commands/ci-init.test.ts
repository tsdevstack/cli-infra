import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockInquirerPrompt = rs.fn();
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirerPrompt(...args),
  },
}));

const mockGcpInitCi = rs.fn();
rs.mock('../utils/gcp/commands', () => ({
  gcpInitCi: (...args: unknown[]) => mockGcpInitCi(...args),
}));

const mockAwsInitCi = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  awsInitCi: (...args: unknown[]) => mockAwsInitCi(...args),
}));

const mockAzureInitCi = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureInitCi: (...args: unknown[]) => mockAzureInitCi(...args),
}));

const mockGenerateInfrastructureSchema = rs.fn();
rs.mock('../utils/infrastructure/generate-infrastructure-schema', () => ({
  generateInfrastructureSchema: (...args: unknown[]) =>
    mockGenerateInfrastructureSchema(...args),
}));

import { ciInit } from './ci-init';

describe('ciInit', () => {
  beforeEach(() => {
    rs.resetAllMocks();
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      cloud: { provider: 'gcp' },
    });
    mocks.findProjectRoot.mockReturnValue('/test/project');
    mocks.getConfigPath.mockReturnValue(
      '/test/project/.tsdevstack/config.json',
    );
    mocks.isCIEnv.mockReturnValue(false);
    mocks.getAvailableEnvironments.mockReturnValue(['dev', 'prod']);
    mockGenerateInfrastructureSchema.mockReturnValue('{}');
    mockInquirerPrompt.mockResolvedValue({ envInput: 'dev, prod' });
  });

  describe('CI provider auto-selection', () => {
    it('should auto-select GitHub when --github not passed', async () => {
      await ciInit({ envs: 'dev,prod' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Auto-selecting GitHub'),
      );
    });

    it('should not log auto-select when --github is passed', async () => {
      await ciInit({ github: true, envs: 'dev,prod' });

      expect(mocks.logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining('Auto-selecting GitHub'),
      );
    });
  });

  describe('non-interactive mode (--envs flag)', () => {
    it('should pass environments from --envs to provider', async () => {
      await ciInit({ github: true, envs: 'dev,prod' });

      expect(mockGcpInitCi).toHaveBeenCalledWith(['dev', 'prod'], 'my-app');
    });

    it('should trim whitespace from environment names', async () => {
      await ciInit({ github: true, envs: ' dev , prod ' });

      expect(mockGcpInitCi).toHaveBeenCalledWith(['dev', 'prod'], 'my-app');
    });

    it('should filter empty environment names', async () => {
      await ciInit({ github: true, envs: 'dev,,prod,' });

      expect(mockGcpInitCi).toHaveBeenCalledWith(['dev', 'prod'], 'my-app');
    });
  });

  describe('interactive mode (no --envs)', () => {
    it('should prompt with credential defaults when available', async () => {
      mocks.getAvailableEnvironments.mockReturnValue(['dev', 'staging']);
      mockInquirerPrompt.mockResolvedValue({ envInput: 'dev, staging' });

      await ciInit({ github: true });

      expect(mockInquirerPrompt).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'input',
          name: 'envInput',
          default: 'dev, staging',
        }),
      ]);
    });

    it('should prompt without defaults when no credentials', async () => {
      mocks.getAvailableEnvironments.mockImplementation(() => {
        throw new Error('No credentials');
      });
      mockInquirerPrompt.mockResolvedValue({ envInput: 'dev, prod' });

      await ciInit({ github: true });

      expect(mockInquirerPrompt).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'input',
          name: 'envInput',
          message: expect.stringContaining('e.g. dev, staging, prod'),
        }),
      ]);
    });

    it('should throw when environments are empty after prompt', async () => {
      mocks.getAvailableEnvironments.mockImplementation(() => {
        throw new Error('No credentials');
      });
      mockInquirerPrompt.mockResolvedValue({ envInput: '' });

      await expect(ciInit({ github: true })).rejects.toThrow(mocks.CliError);
    });
  });

  describe('CI mode (isCIEnv)', () => {
    it('should throw when no --envs in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(ciInit({ github: true })).rejects.toThrow(mocks.CliError);
    });

    it('should work with --envs in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await ciInit({ github: true, envs: 'dev,prod' });

      expect(mockGcpInitCi).toHaveBeenCalledWith(['dev', 'prod'], 'my-app');
    });
  });

  describe('cloud provider resolution', () => {
    it('should use provider from config.json', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'aws' },
      });

      await ciInit({ github: true, envs: 'dev,prod' });

      expect(mockAwsInitCi).toHaveBeenCalledWith(['dev', 'prod'], 'my-app');
    });

    it('should prompt for provider when null in config', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: null },
      });
      mockInquirerPrompt
        .mockResolvedValueOnce({ selectedProvider: 'azure' })
        .mockResolvedValueOnce({ envInput: 'dev, prod' });

      await ciInit({ github: true });

      expect(mockInquirerPrompt).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'list',
          name: 'selectedProvider',
        }),
      ]);
      expect(mockAzureInitCi).toHaveBeenCalled();
    });

    it('should write provider back to config.json when prompted', async () => {
      const mockConfig = {
        project: { name: 'my-app' },
        cloud: { provider: null },
      };
      mocks.loadFrameworkConfig.mockReturnValue(mockConfig);
      mockInquirerPrompt
        .mockResolvedValueOnce({ selectedProvider: 'gcp' })
        .mockResolvedValueOnce({ envInput: 'dev' });

      await ciInit({ github: true });

      expect(mocks.writeJsonFile).toHaveBeenCalledWith(
        '/test/project/.tsdevstack/config.json',
        expect.objectContaining({
          cloud: { provider: 'gcp' },
        }),
      );
    });

    it('should throw when null provider in CI mode', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: null },
      });
      mocks.isCIEnv.mockReturnValue(true);

      await expect(ciInit({ github: true, envs: 'dev' })).rejects.toThrow(
        mocks.CliError,
      );
    });
  });

  describe('provider branching', () => {
    it('should call gcpInitCi for GCP provider', async () => {
      await ciInit({ github: true, envs: 'dev,prod' });

      expect(mockGcpInitCi).toHaveBeenCalledWith(['dev', 'prod'], 'my-app');
    });

    it('should call awsInitCi for AWS provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'aws' },
      });

      await ciInit({ github: true, envs: 'dev,prod' });

      expect(mockAwsInitCi).toHaveBeenCalledWith(['dev', 'prod'], 'my-app');
    });

    it('should call azureInitCi for Azure provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'azure' },
      });

      await ciInit({ github: true, envs: 'dev,prod' });

      expect(mockAzureInitCi).toHaveBeenCalledWith(['dev', 'prod'], 'my-app');
    });

    it('should throw unsupported provider error for unknown provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        cloud: { provider: 'unknown' },
      });

      await expect(ciInit({ github: true, envs: 'dev' })).rejects.toThrow(
        mocks.CliError,
      );
    });
  });

  describe('infrastructure schema generation', () => {
    it('should generate infrastructure schema', async () => {
      await ciInit({ github: true, envs: 'dev,prod' });

      expect(mockGenerateInfrastructureSchema).toHaveBeenCalledWith('gcp');
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('infrastructure.schema.json'),
        '{}',
      );
    });
  });
});
