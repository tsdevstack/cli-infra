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
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

rs.mock('../utils/infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: () => ({
    dev: {
      scheduledJobs: [
        {
          name: 'sync-api-key-usage',
          schedule: '*/5 * * * *',
          targetService: 'auth-service',
          endpoint: '/jobs/sync-api-key-usage',
        },
      ],
    },
  }),
}));

const mockRunLogsCommand = rs.fn();
rs.mock('../utils/logs/run-logs-command', () => ({
  runLogsCommand: (...args: unknown[]) => mockRunLogsCommand(...args),
}));

const mockGcpLogsReader = rs.fn();
rs.mock('../utils/gcp/logs/gcp-logs-reader', () => ({
  GcpLogsReader: function GcpLogsReader(params: unknown) {
    mockGcpLogsReader(params);
  },
}));

const mockAzureLogsReader = rs.fn();
rs.mock('../utils/azure/logs/azure-logs-reader', () => ({
  AzureLogsReader: function AzureLogsReader(params: unknown) {
    mockAzureLogsReader(params);
  },
}));

const mockAwsLogsReader = rs.fn();
rs.mock('../utils/aws/logs/aws-logs-reader', () => ({
  AwsLogsReader: function AwsLogsReader(params: unknown) {
    mockAwsLogsReader(params);
  },
}));

import { infraLogs } from './infra-logs';

const credentials = { project_id: 'shop-dev', region: 'us-central1' };

describe('infraLogs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'shop', version: '1.0.0' },
      cloud: { provider: 'gcp' },
      services: [
        { name: 'auth-service', type: 'nestjs', port: 3001, hasDatabase: true },
      ],
    });
    mockRunLogsCommand.mockResolvedValue(undefined);
  });

  describe('Standard use cases', () => {
    it('should read GCP logs with the sources of the environment', async () => {
      mockSetupInfraCommand.mockResolvedValue({
        projectRoot: '/p',
        projectName: 'shop',
        provider: 'gcp',
        targetEnv: 'dev',
        credentials,
        runningInCI: false,
      });

      await infraLogs('auth-service', { env: 'dev', since: '2h' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'dev', since: '2h' },
        'infra:logs',
      );
      expect(mockGcpLogsReader).toHaveBeenCalledWith({
        projectName: 'shop',
        targetEnv: 'dev',
        credentials,
      });
      const params = mockRunLogsCommand.mock.calls[0][0];
      expect(params.sourceName).toBe('auth-service');
      expect(params.targetEnv).toBe('dev');
      expect(params.options).toEqual({ env: 'dev', since: '2h' });
      expect(params.sources.map((s: { name: string }) => s.name)).toEqual([
        'auth-service',
        'kong',
        'migrate-auth-service',
        'sync-api-key-usage',
        'edge',
      ]);
    });

    it('should read AWS logs with the AWS reader', async () => {
      const awsCredentials = { accountId: '1', region: 'eu-west-1' };
      mockSetupInfraCommand.mockResolvedValue({
        projectRoot: '/p',
        projectName: 'shop',
        provider: 'aws',
        targetEnv: 'aws1',
        credentials: awsCredentials,
        runningInCI: false,
      });

      await infraLogs(undefined, { env: 'aws1' });

      expect(mockAwsLogsReader).toHaveBeenCalledWith({
        projectName: 'shop',
        targetEnv: 'aws1',
        credentials: awsCredentials,
      });
      expect(mockRunLogsCommand).toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should read Azure logs with the Azure reader', async () => {
      const azureCredentials = { subscriptionId: 'sub', tenantId: 't' };
      mockSetupInfraCommand.mockResolvedValue({
        projectRoot: '/p',
        projectName: 'shop',
        provider: 'azure',
        targetEnv: 'az4',
        credentials: azureCredentials,
        runningInCI: false,
      });

      await infraLogs('kong', { env: 'az4' });

      expect(mockAzureLogsReader).toHaveBeenCalledWith({
        projectName: 'shop',
        targetEnv: 'az4',
        credentials: azureCredentials,
      });
      expect(mockRunLogsCommand.mock.calls[0][0].sourceName).toBe('kong');
    });
  });
});
