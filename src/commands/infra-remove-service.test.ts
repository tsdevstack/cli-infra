import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

// Add isCIEnv to mocks
const mockIsCIEnv = rs.fn();

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    isCIEnv: () => mockIsCIEnv(),
  })),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

const mockInquirer = {
  prompt: rs.fn(),
};
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirer.prompt(...args),
  },
}));

const mockDiscoverServiceResources = rs.fn();
const mockDiscoverCoupledWorkers = rs.fn();
rs.mock('../utils/gcp/discovery', () => ({
  discoverServiceResources: (...args: unknown[]) =>
    mockDiscoverServiceResources(...args),
  discoverCoupledWorkers: (...args: unknown[]) =>
    mockDiscoverCoupledWorkers(...args),
}));

const mockHasAnyResources = rs.fn();
const mockShowResourceWarning = rs.fn();
const mockBuildDeletionSteps = rs.fn();
const mockExecuteSteps = rs.fn();
const mockShowFailureReport = rs.fn();
const mockFetchAllDbPasswords = rs.fn();
const mockGetOtherEnvironments = rs.fn();
const mockSelectServiceInteractive = rs.fn();
rs.mock('../utils/gcp/remove-service', () => ({
  hasAnyResources: (...args: unknown[]) => mockHasAnyResources(...args),
  showResourceWarning: (...args: unknown[]) => mockShowResourceWarning(...args),
  buildDeletionSteps: (...args: unknown[]) => mockBuildDeletionSteps(...args),
  executeSteps: (...args: unknown[]) => mockExecuteSteps(...args),
  showFailureReport: (...args: unknown[]) => mockShowFailureReport(...args),
  fetchAllDbPasswords: (...args: unknown[]) => mockFetchAllDbPasswords(...args),
  getOtherEnvironments: (...args: unknown[]) =>
    mockGetOtherEnvironments(...args),
  selectServiceInteractive: (...args: unknown[]) =>
    mockSelectServiceInteractive(...args),
}));

import { infraRemoveService } from './infra-remove-service';

describe('infraRemoveService', () => {
  const mockCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: 'key',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'prod',
    credentials: mockCredentials,
    runningInCI: false,
    provider: 'gcp' as const,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockIsCIEnv.mockReturnValue(false);
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockDiscoverServiceResources.mockResolvedValue({
      cloudRunService: true,
      spaBucket: false,
      database: false,
      secretCount: 5,
      serviceAccount: true,
      serviceAccountEmail: 'sa@test.iam.gserviceaccount.com',
      inferredType: 'nestjs',
    });
    mockDiscoverCoupledWorkers.mockResolvedValue([]);
    mockHasAnyResources.mockReturnValue(true);
    mockFetchAllDbPasswords.mockResolvedValue({});
    mockBuildDeletionSteps.mockReturnValue([]);
    mockExecuteSteps.mockResolvedValue({
      completed: [],
      failed: null,
      remaining: [],
    });
    mockGetOtherEnvironments.mockReturnValue([]);
    mockInquirer.prompt.mockResolvedValue({
      runMode: 'delete',
      confirmation: 'auth-service',
      backedUp: true,
    });
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [{ name: 'auth-service', type: 'nestjs' }],
    });
  });

  describe('CI mode validation', () => {
    it('should throw when --confirm not provided in CI mode', async () => {
      mockIsCIEnv.mockReturnValue(true);

      await expect(infraRemoveService('auth-service', {})).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should allow CI mode with --confirm flag', async () => {
      mockIsCIEnv.mockReturnValue(true);

      await infraRemoveService('auth-service', { confirm: true });

      expect(mockDiscoverServiceResources).toHaveBeenCalled();
    });

    it('should require service name in CI mode', async () => {
      mockIsCIEnv.mockReturnValue(true);

      await expect(
        infraRemoveService(undefined, { confirm: true }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('interactive service selection', () => {
    it('should prompt for service selection when name not provided', async () => {
      mockSelectServiceInteractive.mockResolvedValue('selected-service');

      await infraRemoveService(undefined, { dryRun: true });

      expect(mockSelectServiceInteractive).toHaveBeenCalled();
    });

    it('should use provided service name directly', async () => {
      await infraRemoveService('auth-service', { dryRun: true });

      expect(mockSelectServiceInteractive).not.toHaveBeenCalled();
    });
  });

  describe('resource discovery', () => {
    it('should discover service resources from cloud', async () => {
      await infraRemoveService('auth-service', { dryRun: true });

      expect(mockDiscoverServiceResources).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'auth-service',
          projectName: 'my-app',
          projectId: 'gcp-project-123',
        }),
      );
    });

    it('should handle no resources found', async () => {
      mockHasAnyResources.mockReturnValue(false);

      await infraRemoveService('auth-service', {});

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No cloud resources found'),
      );
    });

    it('should discover coupled workers when service account exists', async () => {
      mockDiscoverServiceResources.mockResolvedValue({
        serviceAccount: true,
        serviceAccountEmail: 'sa@test.iam',
        inferredType: 'nestjs',
      });

      await infraRemoveService('auth-service', { dryRun: true });

      expect(mockDiscoverCoupledWorkers).toHaveBeenCalled();
    });
  });

  describe('dry run mode', () => {
    it('should not execute deletion in dry run mode', async () => {
      await infraRemoveService('auth-service', { dryRun: true });

      expect(mockExecuteSteps).not.toHaveBeenCalled();
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Dry run complete'),
      );
    });

    it('should prompt for dry run in interactive mode', async () => {
      mockInquirer.prompt.mockResolvedValue({ runMode: 'dry-run' });

      await infraRemoveService('auth-service', {});

      expect(mockExecuteSteps).not.toHaveBeenCalled();
    });
  });

  describe('deletion flow', () => {
    it('should fetch database passwords before deletion', async () => {
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ confirmation: 'auth-service' });

      await infraRemoveService('auth-service', {});

      expect(mockFetchAllDbPasswords).toHaveBeenCalled();
    });

    it('should build deletion steps', async () => {
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ confirmation: 'auth-service' });

      await infraRemoveService('auth-service', {});

      expect(mockBuildDeletionSteps).toHaveBeenCalled();
    });

    it('should execute deletion steps', async () => {
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ confirmation: 'auth-service' });

      await infraRemoveService('auth-service', {});

      expect(mockExecuteSteps).toHaveBeenCalled();
    });

    it('should handle deletion failure', async () => {
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ confirmation: 'auth-service' });
      mockExecuteSteps.mockResolvedValue({
        completed: [{ name: 'step1' }],
        failed: { name: 'step2', error: 'Failed' },
        remaining: [{ name: 'step3' }],
      });

      await expect(infraRemoveService('auth-service', {})).rejects.toThrow(
        mocks.CliError,
      );

      expect(mockShowFailureReport).toHaveBeenCalled();
    });
  });

  describe('database backup prompt', () => {
    it('should prompt for database backup when database exists', async () => {
      mockDiscoverServiceResources.mockResolvedValue({
        cloudRunService: true,
        database: true,
        serviceAccount: true,
        serviceAccountEmail: 'sa@test.iam',
        inferredType: 'nestjs',
      });
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ backedUp: true })
        .mockResolvedValueOnce({ confirmation: 'auth-service' });

      await infraRemoveService('auth-service', {});

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('BACKUP YOUR DATABASE'),
      );
    });

    it('should abort when user has not backed up database', async () => {
      mockDiscoverServiceResources.mockResolvedValue({
        cloudRunService: true,
        database: true,
        serviceAccount: true,
        serviceAccountEmail: 'sa@test.iam',
        inferredType: 'nestjs',
      });
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ backedUp: false });

      await infraRemoveService('auth-service', {});

      expect(mockExecuteSteps).not.toHaveBeenCalled();
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Please back up'),
      );
    });
  });

  describe('confirmation', () => {
    it('should abort when confirmation does not match', async () => {
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ confirmation: 'wrong-name' });

      await infraRemoveService('auth-service', {});

      expect(mockExecuteSteps).not.toHaveBeenCalled();
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Confirmation did not match'),
      );
    });
  });

  describe('success logging', () => {
    it('should log success message after deletion', async () => {
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ confirmation: 'auth-service' });

      await infraRemoveService('auth-service', {});

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('removed from prod'),
      );
    });

    it('should show next steps for service in config', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [{ name: 'auth-service', type: 'nestjs' }],
      });
      mockInquirer.prompt
        .mockResolvedValueOnce({ runMode: 'delete' })
        .mockResolvedValueOnce({ confirmation: 'auth-service' });

      await infraRemoveService('auth-service', {});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('remove-service'),
      );
    });
  });
});
