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

const mockGcpGenerateCiWorkflows = rs.fn();
rs.mock('../utils/gcp/commands', () => ({
  gcpGenerateCiWorkflows: (...args: unknown[]) =>
    mockGcpGenerateCiWorkflows(...args),
}));

const mockAwsGenerateCiWorkflows = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  awsGenerateCiWorkflows: (...args: unknown[]) =>
    mockAwsGenerateCiWorkflows(...args),
}));

const mockAzureGenerateCiWorkflows = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureGenerateCiWorkflows: (...args: unknown[]) =>
    mockAzureGenerateCiWorkflows(...args),
}));

import { ciGenerate } from './ci-generate';

describe('ciGenerate', () => {
  beforeEach(() => {
    rs.resetAllMocks();
    mocks.loadFrameworkConfig.mockReturnValue({
      cloud: { provider: 'gcp' },
    });
  });

  describe('provider branching', () => {
    it('should call gcpGenerateCiWorkflows for GCP provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        cloud: { provider: 'gcp' },
      });

      await ciGenerate();

      expect(mockGcpGenerateCiWorkflows).toHaveBeenCalled();
    });

    it('should call awsGenerateCiWorkflows for AWS provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        cloud: { provider: 'aws' },
      });

      await ciGenerate();

      expect(mockAwsGenerateCiWorkflows).toHaveBeenCalled();
    });

    it('should call azureGenerateCiWorkflows for Azure provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        cloud: { provider: 'azure' },
      });

      await ciGenerate();

      expect(mockAzureGenerateCiWorkflows).toHaveBeenCalled();
    });

    it('should throw unsupported provider error for unknown provider', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        cloud: { provider: 'unknown' },
      });

      await expect(ciGenerate()).rejects.toThrow(mocks.CliError);
    });
  });

  describe('no provider configured', () => {
    it('should throw when cloud provider is null', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        cloud: { provider: null },
      });

      await expect(ciGenerate()).rejects.toThrow(mocks.CliError);
    });
  });

  describe('logging', () => {
    it('should log success message', async () => {
      await ciGenerate();

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('regenerated successfully'),
      );
    });
  });
});
