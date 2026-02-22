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
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

const mockDiscoverDeployedServices = rs.fn();
rs.mock('../utils/gcp/discovery', () => ({
  discoverDeployedServices: (...args: unknown[]) =>
    mockDiscoverDeployedServices(...args),
}));

import { infraListDeployed } from './infra-list-deployed';

describe('infraListDeployed', () => {
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
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mockDiscoverDeployedServices.mockResolvedValue({
      success: true,
      services: [],
    });
  });

  describe('context setup', () => {
    it('should set up GCP infra command context', async () => {
      await infraListDeployed({});

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        {},
        'infra:list-deployed',
      );
    });

    it('should pass env option to setup', async () => {
      await infraListDeployed({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:list-deployed',
      );
    });
  });

  describe('service discovery', () => {
    it('should discover services from cloud', async () => {
      await infraListDeployed({});

      expect(mockDiscoverDeployedServices).toHaveBeenCalledWith({
        projectName: 'my-app',
        projectId: 'gcp-project-123',
        region: 'us-central1',
        sqlInstanceName: 'my-app-postgres',
        credentials: mockCredentials,
      });
    });

    it('should throw when discovery fails', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: false,
        error: 'API error',
        services: [],
      });

      await expect(infraListDeployed({})).rejects.toThrow(mocks.CliError);
    });

    it('should handle unknown error gracefully', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: false,
        services: [],
      });

      await expect(infraListDeployed({})).rejects.toThrow(mocks.CliError);
    });
  });

  describe('empty results', () => {
    it('should warn when no services found', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [],
      });

      await infraListDeployed({});

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No deployed services found'),
      );
    });
  });

  describe('service display', () => {
    it('should display services in table format', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            type: 'nestjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: true,
              secretCount: 5,
              hasServiceAccount: true,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('auth-service'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('nestjs'),
      );
    });

    it('should display Cloud Run resource', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'api-service',
            type: 'nestjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: false,
              secretCount: 0,
              hasServiceAccount: false,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Cloud Run'),
      );
    });

    it('should display SPA Bucket resource', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'frontend',
            type: 'nextjs-spa',
            status: 'DEPLOYED',
            resources: {
              cloudRunService: false,
              spaBucket: true,
              hasDatabase: false,
              secretCount: 0,
              hasServiceAccount: false,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('SPA Bucket'),
      );
    });

    it('should display Database resource', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            type: 'nestjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: true,
              secretCount: 0,
              hasServiceAccount: false,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Database'),
      );
    });

    it('should display secret count', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            type: 'nestjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: false,
              secretCount: 10,
              hasServiceAccount: false,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Secrets(10)'),
      );
    });

    it('should display IAM resource', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            type: 'nestjs',
            status: 'SERVING',
            resources: {
              cloudRunService: false,
              spaBucket: false,
              hasDatabase: false,
              secretCount: 0,
              hasServiceAccount: true,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('IAM'),
      );
    });

    it('should display "none" when no resources', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'orphan-service',
            type: 'unknown',
            status: 'UNKNOWN',
            resources: {
              cloudRunService: false,
              spaBucket: false,
              hasDatabase: false,
              secretCount: 0,
              hasServiceAccount: false,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('none'),
      );
    });

    it('should display multiple services', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            type: 'nestjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: true,
              secretCount: 5,
              hasServiceAccount: true,
            },
          },
          {
            name: 'frontend',
            type: 'nextjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: false,
              secretCount: 3,
              hasServiceAccount: true,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('auth-service'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('frontend'),
      );
    });
  });

  describe('total count', () => {
    it('should display total count for single service', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            type: 'nestjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: false,
              secretCount: 0,
              hasServiceAccount: false,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Total: 1 service'),
      );
    });

    it('should display plural count for multiple services', async () => {
      mockDiscoverDeployedServices.mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            type: 'nestjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: false,
              secretCount: 0,
              hasServiceAccount: false,
            },
          },
          {
            name: 'frontend',
            type: 'nextjs',
            status: 'SERVING',
            resources: {
              cloudRunService: true,
              spaBucket: false,
              hasDatabase: false,
              secretCount: 0,
              hasServiceAccount: false,
            },
          },
        ],
      });

      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Total: 2 services'),
      );
    });
  });

  describe('environment display', () => {
    it('should display environment and project info', async () => {
      await infraListDeployed({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Environment: prod'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Project: my-app'),
      );
    });
  });
});
