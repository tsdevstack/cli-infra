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

const mockAzureRunCron = rs.fn();
rs.mock('../utils/azure/commands', () => ({
  azureRunCron: (...args: unknown[]) => mockAzureRunCron(...args),
}));

const mockGcpRunCron = rs.fn();
rs.mock('../utils/gcp/commands', () => ({
  gcpRunCron: (...args: unknown[]) => mockGcpRunCron(...args),
}));

const mockAwsRunCron = rs.fn();
rs.mock('../utils/aws/commands', () => ({
  awsRunCron: (...args: unknown[]) => mockAwsRunCron(...args),
}));

import { infraRunCron } from './infra-run-cron';

describe('infraRunCron', () => {
  const azureContext = {
    provider: 'azure',
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'prod',
    credentials: { subscriptionId: 'sub' },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should run the Azure handler with the job name', async () => {
    mockSetupInfraCommand.mockResolvedValue(azureContext);

    await infraRunCron({ env: 'prod', job: 'usage-report' });

    expect(mockSetupInfraCommand).toHaveBeenCalledWith(
      { env: 'prod', job: 'usage-report' },
      'infra:run-cron',
    );
    expect(mockAzureRunCron).toHaveBeenCalledWith(azureContext, {
      job: 'usage-report',
    });
  });

  it('should run the GCP handler with the job name', async () => {
    const gcpContext = { ...azureContext, provider: 'gcp' };
    mockSetupInfraCommand.mockResolvedValue(gcpContext);

    await infraRunCron({ env: 'prod', job: 'usage-report' });

    expect(mockGcpRunCron).toHaveBeenCalledWith(gcpContext, {
      job: 'usage-report',
      lines: true,
    });
    expect(mockAzureRunCron).not.toHaveBeenCalled();
  });

  it("should pass --no-lines on: a failed run's log lines are left out", async () => {
    const gcpContext = { ...azureContext, provider: 'gcp' };
    mockSetupInfraCommand.mockResolvedValue(gcpContext);
    await infraRunCron({ env: 'prod', job: 'usage-report', lines: false });
    expect(mockGcpRunCron).toHaveBeenCalledWith(gcpContext, {
      job: 'usage-report',
      lines: false,
    });

    const awsContext = { ...azureContext, provider: 'aws' };
    mockSetupInfraCommand.mockResolvedValue(awsContext);
    await infraRunCron({ env: 'prod', job: 'usage-report', lines: false });
    expect(mockAwsRunCron).toHaveBeenCalledWith(awsContext, {
      job: 'usage-report',
      lines: false,
    });
  });

  it('should run the AWS handler with the job name', async () => {
    const awsContext = { ...azureContext, provider: 'aws' };
    mockSetupInfraCommand.mockResolvedValue(awsContext);

    await infraRunCron({ env: 'prod', job: 'usage-report' });

    expect(mockAwsRunCron).toHaveBeenCalledWith(awsContext, {
      job: 'usage-report',
      lines: true,
    });
    expect(mockAzureRunCron).not.toHaveBeenCalled();
  });

  it('should refuse a provider it does not know', async () => {
    mockSetupInfraCommand.mockResolvedValue({
      ...azureContext,
      provider: 'other',
    });

    await expect(infraRunCron({ job: 'usage-report' })).rejects.toThrow(
      mocks.CliError,
    );
    expect(mockAzureRunCron).not.toHaveBeenCalled();
    expect(mockGcpRunCron).not.toHaveBeenCalled();
    expect(mockAwsRunCron).not.toHaveBeenCalled();
  });
});
