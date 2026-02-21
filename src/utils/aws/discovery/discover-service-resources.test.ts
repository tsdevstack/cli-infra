import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { discoverServiceResources } from './discover-service-resources';
import * as getEcsServiceModule from './get-ecs-service';
import * as getAppRunnerServiceModule from './get-apprunner-service';
import * as bucketExistsModule from './bucket-exists';
import * as listSecretsByPrefixModule from './list-secrets-by-prefix';

rs.mock('./get-ecs-service', { mock: true });
rs.mock('./get-apprunner-service', { mock: true });
rs.mock('./bucket-exists', { mock: true });
rs.mock('./list-secrets-by-prefix', { mock: true });

describe('discoverServiceResources', () => {
  const mockCredentials = {
    region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    accountId: '123456789012',
  };

  const baseOptions = {
    serviceName: 'auth-service',
    projectName: 'myproject',
    targetEnv: 'dev',
    credentials: mockCredentials,
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('backend service (ECS)', () => {
    it('should detect backend service with ECS', async () => {
      rs.mocked(getEcsServiceModule.getEcsService).mockResolvedValueOnce({
        success: true,
        service: {
          exists: true,
          serviceName: 'auth-service',
          status: 'ACTIVE',
          runningCount: 1,
          desiredCount: 1,
          pendingCount: 0,
          taskDefinition:
            'arn:aws:ecs:us-east-1:123456789012:task-definition/auth-service:5',
          deploymentStatus: 'COMPLETED',
        },
      });
      rs.mocked(
        getAppRunnerServiceModule.getAppRunnerService,
      ).mockResolvedValueOnce({
        success: true,
        service: {
          exists: false,
          serviceName: 'auth-service',
          status: 'NOT_FOUND',
        },
      });
      rs.mocked(bucketExistsModule.bucketExists).mockResolvedValueOnce({
        exists: false,
      });
      rs.mocked(
        listSecretsByPrefixModule.listSecretsByPrefix,
      ).mockResolvedValueOnce({
        success: true,
        secrets: [
          { name: 'myproject-auth-service-DATABASE_URL', arn: 'arn:...' },
        ],
      });

      const result = await discoverServiceResources(baseOptions);

      expect(result.ecsService).toBe(true);
      expect(result.ecsStatus).toBe('ACTIVE');
      expect(result.ecsRunningCount).toBe(1);
      expect(result.appRunnerService).toBe(false);
      expect(result.spaBucket).toBe(false);
      expect(result.secrets).toHaveLength(1);
      expect(result.inferredType).toBe('backend');
    });
  });

  describe('worker service (ECS)', () => {
    it('should detect worker service', async () => {
      rs.mocked(getEcsServiceModule.getEcsService).mockResolvedValueOnce({
        success: true,
        service: {
          exists: true,
          serviceName: 'offers-worker',
          status: 'ACTIVE',
          runningCount: 1,
          desiredCount: 1,
          pendingCount: 0,
        },
      });
      rs.mocked(
        getAppRunnerServiceModule.getAppRunnerService,
      ).mockResolvedValueOnce({
        success: true,
        service: {
          exists: false,
          serviceName: 'offers-worker',
          status: 'NOT_FOUND',
        },
      });
      rs.mocked(bucketExistsModule.bucketExists).mockResolvedValueOnce({
        exists: false,
      });
      rs.mocked(
        listSecretsByPrefixModule.listSecretsByPrefix,
      ).mockResolvedValueOnce({
        success: true,
        secrets: [],
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'offers-worker',
      });

      expect(result.ecsService).toBe(true);
      expect(result.inferredType).toBe('worker');
    });
  });

  describe('kong service (ECS)', () => {
    it('should detect kong service', async () => {
      rs.mocked(getEcsServiceModule.getEcsService).mockResolvedValueOnce({
        success: true,
        service: {
          exists: true,
          serviceName: 'kong',
          status: 'ACTIVE',
          runningCount: 1,
          desiredCount: 1,
          pendingCount: 0,
        },
      });
      rs.mocked(
        getAppRunnerServiceModule.getAppRunnerService,
      ).mockResolvedValueOnce({
        success: true,
        service: { exists: false, serviceName: 'kong', status: 'NOT_FOUND' },
      });
      rs.mocked(bucketExistsModule.bucketExists).mockResolvedValueOnce({
        exists: false,
      });
      rs.mocked(
        listSecretsByPrefixModule.listSecretsByPrefix,
      ).mockResolvedValueOnce({
        success: true,
        secrets: [],
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'kong',
      });

      expect(result.ecsService).toBe(true);
      expect(result.inferredType).toBe('kong');
    });
  });

  describe('nextjs service (App Runner)', () => {
    it('should detect nextjs service with App Runner', async () => {
      rs.mocked(getEcsServiceModule.getEcsService).mockResolvedValueOnce({
        success: true,
        service: {
          exists: false,
          serviceName: 'frontend',
          status: 'NOT_FOUND',
          runningCount: 0,
          desiredCount: 0,
          pendingCount: 0,
        },
      });
      rs.mocked(
        getAppRunnerServiceModule.getAppRunnerService,
      ).mockResolvedValueOnce({
        success: true,
        service: {
          exists: true,
          serviceName: 'frontend',
          status: 'RUNNING',
          serviceUrl: 'abc123.awsapprunner.com',
        },
      });
      rs.mocked(bucketExistsModule.bucketExists).mockResolvedValueOnce({
        exists: false,
      });
      rs.mocked(
        listSecretsByPrefixModule.listSecretsByPrefix,
      ).mockResolvedValueOnce({
        success: true,
        secrets: [],
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'frontend',
      });

      expect(result.ecsService).toBe(false);
      expect(result.appRunnerService).toBe(true);
      expect(result.appRunnerStatus).toBe('RUNNING');
      expect(result.appRunnerUrl).toBe('abc123.awsapprunner.com');
      expect(result.inferredType).toBe('nextjs');
    });
  });

  describe('spa service (S3)', () => {
    it('should detect spa service with S3 bucket', async () => {
      rs.mocked(getEcsServiceModule.getEcsService).mockResolvedValueOnce({
        success: true,
        service: {
          exists: false,
          serviceName: 'admin',
          status: 'NOT_FOUND',
          runningCount: 0,
          desiredCount: 0,
          pendingCount: 0,
        },
      });
      rs.mocked(
        getAppRunnerServiceModule.getAppRunnerService,
      ).mockResolvedValueOnce({
        success: true,
        service: { exists: false, serviceName: 'admin', status: 'NOT_FOUND' },
      });
      rs.mocked(bucketExistsModule.bucketExists).mockResolvedValueOnce({
        exists: true,
      });
      rs.mocked(
        listSecretsByPrefixModule.listSecretsByPrefix,
      ).mockResolvedValueOnce({
        success: true,
        secrets: [],
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'admin',
      });

      expect(result.ecsService).toBe(false);
      expect(result.appRunnerService).toBe(false);
      expect(result.spaBucket).toBe(true);
      expect(result.spaBucketName).toBe('myproject-admin-spa');
      expect(result.inferredType).toBe('spa');
    });
  });

  describe('unknown service', () => {
    it('should return unknown when no resources found', async () => {
      rs.mocked(getEcsServiceModule.getEcsService).mockResolvedValueOnce({
        success: true,
        service: {
          exists: false,
          serviceName: 'nonexistent',
          status: 'NOT_FOUND',
          runningCount: 0,
          desiredCount: 0,
          pendingCount: 0,
        },
      });
      rs.mocked(
        getAppRunnerServiceModule.getAppRunnerService,
      ).mockResolvedValueOnce({
        success: true,
        service: {
          exists: false,
          serviceName: 'nonexistent',
          status: 'NOT_FOUND',
        },
      });
      rs.mocked(bucketExistsModule.bucketExists).mockResolvedValueOnce({
        exists: false,
      });
      rs.mocked(
        listSecretsByPrefixModule.listSecretsByPrefix,
      ).mockResolvedValueOnce({
        success: true,
        secrets: [],
      });

      const result = await discoverServiceResources({
        ...baseOptions,
        serviceName: 'nonexistent',
      });

      expect(result.ecsService).toBe(false);
      expect(result.appRunnerService).toBe(false);
      expect(result.spaBucket).toBe(false);
      expect(result.inferredType).toBe('unknown');
    });
  });
});
