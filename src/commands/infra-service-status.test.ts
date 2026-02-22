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

const mockInquirerPrompt = rs.fn();
rs.mock('inquirer', () => ({
  default: {
    prompt: (...args: unknown[]) => mockInquirerPrompt(...args),
  },
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

const mockDiscoverServiceResources = rs.fn();
const mockDiscoverDeployedServices = rs.fn();
rs.mock('../utils/gcp/discovery', () => ({
  discoverServiceResources: (...args: unknown[]) =>
    mockDiscoverServiceResources(...args),
  discoverDeployedServices: (...args: unknown[]) =>
    mockDiscoverDeployedServices(...args),
}));

import { infraServiceStatus } from './infra-service-status';

describe('infraServiceStatus', () => {
  const mockCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
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
    mocks.isCIEnv.mockReturnValue(false);
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockDiscoverServiceResources.mockResolvedValue({
      cloudRunService: true,
      cloudRunServiceUrl: 'https://auth-service-xyz.run.app',
      database: true,
      secrets: ['DATABASE_URL', 'JWT_SECRET'],
      serviceAccount: true,
      serviceAccountEmail: 'auth-sa@gcp-project-123.iam.gserviceaccount.com',
      spaBucket: false,
      spaBucketName: null,
      inferredType: 'nestjs',
    });
    mockDiscoverDeployedServices.mockResolvedValue({
      success: true,
      services: [{ name: 'auth-service' }],
    });
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs' },
        { name: 'frontend', type: 'nextjs' },
      ],
    });
    mockInquirerPrompt.mockResolvedValue({ serviceName: 'auth-service' });
  });

  describe('CI mode', () => {
    it('should throw when service name missing in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await expect(
        infraServiceStatus(undefined, { env: 'prod' }),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should work with service name in CI mode', async () => {
      mocks.isCIEnv.mockReturnValue(true);

      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mockDiscoverServiceResources).toHaveBeenCalled();
    });
  });

  describe('with service name provided', () => {
    it('should discover resources for specified service', async () => {
      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mockDiscoverServiceResources).toHaveBeenCalledWith({
        serviceName: 'auth-service',
        projectName: 'my-app',
        projectId: 'gcp-project-123',
        region: 'us-central1',
        sqlInstanceName: 'my-app-postgres',
        credentials: mockCredentials,
      });
    });
  });

  describe('interactive selection', () => {
    it('should discover deployed services for selection', async () => {
      await infraServiceStatus(undefined, { env: 'prod' });

      expect(mockDiscoverDeployedServices).toHaveBeenCalled();
    });

    it('should combine config and cloud services', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [{ name: 'cloud-only-service' }],
      });

      await infraServiceStatus(undefined, { env: 'prod' });

      const promptCall = mockInquirerPrompt.mock.calls[0][0][0];
      const choices = promptCall.choices.map((c: { value: string }) => c.value);

      // Should include both config services and cloud-discovered service
      expect(choices).toContain('auth-service');
      expect(choices).toContain('frontend');
      expect(choices).toContain('cloud-only-service');
    });

    it('should throw when no services found', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [],
      });
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [],
      });

      await expect(
        infraServiceStatus(undefined, { env: 'prod' }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('resource display', () => {
    it('should show Cloud Run service when found', async () => {
      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Cloud Run'),
      );
    });

    it('should show database when found', async () => {
      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Database'),
      );
    });

    it('should show secrets count when found', async () => {
      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('Secrets'),
      );
    });

    it('should show not found for missing resources', async () => {
      mockDiscoverServiceResources.mockResolvedValue({
        cloudRunService: false,
        database: false,
        secrets: [],
        serviceAccount: false,
        spaBucket: false,
        inferredType: 'unknown',
      });

      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cloud Run: not found'),
      );
    });

    it('should show SPA bucket when found', async () => {
      mockDiscoverServiceResources.mockResolvedValue({
        cloudRunService: false,
        database: false,
        secrets: [],
        serviceAccount: false,
        spaBucket: true,
        spaBucketName: 'my-app-landing',
        inferredType: 'spa',
      });

      await infraServiceStatus('landing', { env: 'prod' });

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('SPA Bucket'),
      );
    });
  });

  describe('logging', () => {
    it('should log service and environment', async () => {
      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Service: auth-service'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Environment: prod'),
      );
    });

    it('should show detected service type', async () => {
      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Detected type: nestjs'),
      );
    });

    it('should warn when type is unknown', async () => {
      mockDiscoverServiceResources.mockResolvedValue({
        cloudRunService: false,
        database: false,
        secrets: [],
        serviceAccount: false,
        spaBucket: false,
        inferredType: 'unknown',
      });

      await infraServiceStatus('auth-service', { env: 'prod' });

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('unknown'),
      );
    });
  });
});
