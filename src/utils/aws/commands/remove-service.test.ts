import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../discovery', () => ({
  discoverServiceResources: rs.fn(),
  discoverCoupledWorkers: rs.fn(),
}));

rs.mock('../remove-service', () => ({
  hasAnyResources: rs.fn(),
  showResourceWarning: rs.fn(),
  buildDeletionSteps: rs.fn(),
  executeSteps: rs.fn(),
  showFailureReport: rs.fn(),
  fetchAllDbPasswords: rs.fn(),
  getOtherEnvironments: rs.fn(),
  selectServiceInteractive: rs.fn(),
}));

rs.mock('inquirer', () => ({
  default: {
    prompt: rs.fn(),
  },
}));

import { awsRemoveService } from './remove-service';
import { discoverServiceResources, discoverCoupledWorkers } from '../discovery';
import {
  hasAnyResources,
  buildDeletionSteps,
  executeSteps,
  fetchAllDbPasswords,
  getOtherEnvironments,
  selectServiceInteractive,
} from '../remove-service';
import inquirer from 'inquirer';

describe('awsRemoveService', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      accountId: '123456789012',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      region: 'us-east-1',
    },
    runningInCI: false,
  };

  const mockParams = {
    serviceName: 'auth-service' as string | undefined,
    ctx: mockCtx,
    runningInCI: false,
    dryRunOption: undefined as boolean | undefined,
    confirmOption: undefined as boolean | undefined,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      secrets: ['DATABASE_URL'],
      inferredType: 'backend',
    });

    rs.mocked(discoverCoupledWorkers).mockResolvedValue([]);
    rs.mocked(hasAnyResources).mockReturnValue(true);
    rs.mocked(fetchAllDbPasswords).mockResolvedValue({
      'auth-service': 'pass123',
    });
    rs.mocked(getOtherEnvironments).mockReturnValue([]);
    rs.mocked(buildDeletionSteps).mockReturnValue([]);
    rs.mocked(executeSteps).mockResolvedValue({
      completed: [],
      failed: null,
      remaining: [],
    });

    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'auth-service' }],
    });

    // Mock inquirer for mode selection, confirmation
    rs.mocked(inquirer.prompt)
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ backedUp: true })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });
  });

  it('should throw in CI when no service name provided', async () => {
    await expect(
      awsRemoveService({
        ...mockParams,
        serviceName: undefined,
        runningInCI: true,
      }),
    ).rejects.toThrow(mocks.CliError);
  });

  it('should use interactive selection when no service name', async () => {
    rs.mocked(selectServiceInteractive).mockResolvedValue('auth-service');

    await awsRemoveService({
      ...mockParams,
      serviceName: undefined,
      dryRunOption: true,
    });

    expect(selectServiceInteractive).toHaveBeenCalled();
  });

  it('should abort when no resources found', async () => {
    rs.mocked(hasAnyResources).mockReturnValue(false);

    const result = await awsRemoveService(mockParams);

    expect(result.aborted).toBe(true);
  });

  it('should abort on dry run', async () => {
    const result = await awsRemoveService({
      ...mockParams,
      dryRunOption: true,
    });

    expect(result.aborted).toBe(true);
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Dry run complete'),
    );
  });

  it('should abort when user cancels confirmation', async () => {
    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ backedUp: true })
      .mockResolvedValueOnce({ confirmation: 'wrong-name' });

    const result = await awsRemoveService(mockParams);

    expect(result.aborted).toBe(true);
  });

  it('should execute deletion steps on confirm', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      secrets: [],
      inferredType: 'backend',
    });

    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ backedUp: true })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });

    await awsRemoveService(mockParams);

    expect(buildDeletionSteps).toHaveBeenCalled();
    expect(executeSteps).toHaveBeenCalled();
  });

  it('should throw when deletion step fails', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      secrets: [],
      inferredType: 'backend',
    });

    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ backedUp: true })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });

    rs.mocked(executeSteps).mockResolvedValue({
      completed: [],
      failed: { name: 'Delete ECS service', resource: 'ecs', execute: rs.fn() },
      remaining: [],
    });

    await expect(awsRemoveService(mockParams)).rejects.toThrow(mocks.CliError);
  });

  it('should return service name on successful removal', async () => {
    rs.mocked(discoverServiceResources).mockResolvedValue({
      ecsService: true,
      spaBucket: false,
      spaBucketName: '',
      secrets: [],
      inferredType: 'backend',
    });

    rs.mocked(inquirer.prompt)
      .mockReset()
      .mockResolvedValueOnce({ runMode: 'delete' })
      .mockResolvedValueOnce({ backedUp: true })
      .mockResolvedValueOnce({ confirmation: 'auth-service' });

    const result = await awsRemoveService(mockParams);

    expect(result.aborted).toBe(false);
    expect(result.serviceName).toBe('auth-service');
  });
});
