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
const mockGcpGenerate = rs.fn();

rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

rs.mock('../utils/gcp/commands', () => ({
  gcpGenerate: (...args: unknown[]) => mockGcpGenerate(...args),
}));

const mockAwsGenerate = rs.fn();

rs.mock('../utils/aws/commands', () => ({
  awsGenerate: (...args: unknown[]) => mockAwsGenerate(...args),
}));

import { infraGenerate } from './infra-generate';

describe('infraGenerate', () => {
  const mockGCPCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: 'key',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'gcp' as const,
    targetEnv: 'prod',
    credentials: mockGCPCredentials,
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockGcpGenerate.mockResolvedValue(undefined);
    mockAwsGenerate.mockResolvedValue(undefined);
  });

  describe('context setup', () => {
    it('should call setupInfraCommand with options', async () => {
      await infraGenerate({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:generate',
      );
    });
  });

  describe('GCP provider routing', () => {
    it('should call gcpGenerate for GCP provider', async () => {
      await infraGenerate({});

      expect(mockGcpGenerate).toHaveBeenCalledWith(mockGCPContext);
    });

    it('should not call gcpGenerate for non-GCP provider', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        ...mockGCPContext,
        provider: 'aws',
      });

      await infraGenerate({});

      expect(mockGcpGenerate).not.toHaveBeenCalled();
    });

    it('should call awsGenerate for AWS provider', async () => {
      const mockAWSContext = {
        ...mockGCPContext,
        provider: 'aws' as const,
        credentials: {
          accessKeyId: 'test-key',
          secretAccessKey: 'test-secret',
          accountId: '123456789012',
          region: 'us-east-1',
        },
      };
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraGenerate({});

      expect(mockAwsGenerate).toHaveBeenCalledWith(mockAWSContext);
      expect(mockGcpGenerate).not.toHaveBeenCalled();
    });
  });

  describe('logging', () => {
    it('should log generating message', async () => {
      await infraGenerate({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Generating infrastructure configuration'),
      );
    });
  });
});
