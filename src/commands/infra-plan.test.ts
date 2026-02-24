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

const mockSetupInfraCommand = rs.fn();
const mockGcpPlan = rs.fn();
const mockAwsPlan = rs.fn();

rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

rs.mock('../utils/gcp/commands', () => ({
  gcpPlan: (...args: unknown[]) => mockGcpPlan(...args),
}));

rs.mock('../utils/aws/commands', () => ({
  awsPlan: (...args: unknown[]) => mockAwsPlan(...args),
}));

import { infraPlan } from './infra-plan';

describe('infraPlan', () => {
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
    mockGcpPlan.mockResolvedValue(undefined);
    mockAwsPlan.mockResolvedValue(undefined);
  });

  describe('context setup', () => {
    it('should call setupInfraCommand with options', async () => {
      await infraPlan({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:plan',
      );
    });
  });

  describe('GCP provider routing', () => {
    it('should call gcpPlan for GCP provider', async () => {
      await infraPlan({});

      expect(mockGcpPlan).toHaveBeenCalledWith(mockGCPContext);
      expect(mockAwsPlan).not.toHaveBeenCalled();
    });
  });

  describe('AWS provider routing', () => {
    const mockAWSContext = {
      projectRoot: '/test/project',
      projectName: 'my-app',
      provider: 'aws' as const,
      targetEnv: 'prod',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        accountId: '123456789012',
        region: 'us-east-1',
      },
      runningInCI: false,
    };

    it('should call awsPlan for AWS provider', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraPlan({});

      expect(mockAwsPlan).toHaveBeenCalledWith(mockAWSContext, {
        forceUnlock: undefined,
      });
      expect(mockGcpPlan).not.toHaveBeenCalled();
    });

    it('should pass forceUnlock option to awsPlan', async () => {
      mockSetupInfraCommand.mockResolvedValue(mockAWSContext);

      await infraPlan({ forceUnlock: true });

      expect(mockAwsPlan).toHaveBeenCalledWith(mockAWSContext, {
        forceUnlock: true,
      });
    });
  });

  describe('logging', () => {
    it('should log planning message', async () => {
      await infraPlan({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Planning infrastructure changes'),
      );
    });
  });
});
