import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../../setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

import { setupGCPInfraCommand } from './setup-gcp-infra-command';

const gcpContext = {
  projectRoot: '/test/project',
  projectName: 'myapp',
  provider: 'gcp' as const,
  targetEnv: 'dev',
  credentials: {
    project_id: 'my-gcp-project',
    region: 'us-central1',
    client_email: 'sa@project.iam.gserviceaccount.com',
    private_key: 'key',
  },
  runningInCI: false,
};

describe('setupGCPInfraCommand', () => {
  beforeEach(() => {
    rs.resetAllMocks();
    mockSetupInfraCommand.mockResolvedValue(gcpContext);
  });

  describe('Standard use cases', () => {
    it('should return context when provider is gcp', async () => {
      const result = await setupGCPInfraCommand({ env: 'dev' }, 'test:cmd');

      expect(result).toEqual(gcpContext);
    });

    it('should pass options and command name to setupInfraCommand', async () => {
      await setupGCPInfraCommand({ env: 'staging' }, 'infra:deploy');

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:deploy',
      );
    });
  });

  describe('Error cases', () => {
    it('should throw CliError when provider is aws', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...gcpContext,
        provider: 'aws',
      });

      await expect(
        setupGCPInfraCommand({ env: 'dev' }, 'test:cmd'),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should throw CliError when provider is azure', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...gcpContext,
        provider: 'azure',
      });

      await expect(
        setupGCPInfraCommand({ env: 'dev' }, 'test:cmd'),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should include command name in error message', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...gcpContext,
        provider: 'aws',
      });

      await expect(
        setupGCPInfraCommand({ env: 'dev' }, 'infra:deploy-lb'),
      ).rejects.toThrow("'infra:deploy-lb' is only available for GCP");
    });
  });
});
