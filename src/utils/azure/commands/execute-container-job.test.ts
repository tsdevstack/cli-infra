/**
 * Tests for execute-container-job
 */

import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const mockBeginCreateOrUpdateAndWait = rs.fn();
const mockBeginStartAndWait = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

// Mock infra-core (includes Azure credential helper)
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
}));

// Mock Azure Container Apps client
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class MockContainerAppsAPIClient {
    jobs = {
      beginCreateOrUpdateAndWait: mockBeginCreateOrUpdateAndWait,
      beginStartAndWait: mockBeginStartAndWait,
    };
    constructor() {}
  },
}));

// Mock poll-container-job-status
rs.mock('./poll-container-job-status', () => ({
  pollContainerJobStatus: rs.fn(),
}));

import { executeContainerJob } from './execute-container-job';
import { pollContainerJobStatus } from './poll-container-job-status';

const testCredentials = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  tenantId: 'test-tenant-id',
  subscriptionId: 'test-subscription-id',
  location: 'eastus2',
};

const baseOptions = {
  credentials: testCredentials,
  resourceGroupName: 'test-rg',
  containerAppsEnvId: '/subscriptions/sub/envs/env',
  jobName: 'migrate-auth-service',
  image: 'myacr.azurecr.io/auth-service:latest',
  command: [
    'node',
    './node_modules/prisma/build/index.js',
    'migrate',
    'deploy',
  ],
};

describe('executeContainerJob', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  describe('Standard use cases', () => {
    it('should return success when job completes', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      const result = await executeContainerJob(baseOptions);

      expect(result.success).toBe(true);
      expect(result.logs).toBe('Job completed successfully');
    });

    it('should create job with correct configuration', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      await executeContainerJob(baseOptions);

      expect(mockBeginCreateOrUpdateAndWait).toHaveBeenCalledWith(
        'test-rg',
        'migrate-auth-service',
        expect.objectContaining({
          location: 'eastus2',
          environmentId: '/subscriptions/sub/envs/env',
          configuration: expect.objectContaining({
            triggerType: 'Manual',
            replicaTimeout: 300,
            replicaRetryLimit: 0,
          }),
        }),
      );
    });

    it('should call beginStartAndWait after job creation', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      await executeContainerJob(baseOptions);

      expect(mockBeginStartAndWait).toHaveBeenCalledWith(
        'test-rg',
        'migrate-auth-service',
        {},
      );
    });

    it('should pass env vars to container', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      await executeContainerJob({
        ...baseOptions,
        envVars: [{ name: 'DATABASE_URL', value: 'postgres://localhost' }],
      });

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      const container = jobDef.template.containers[0];
      expect(container.env).toEqual([
        { name: 'DATABASE_URL', value: 'postgres://localhost' },
      ]);
    });

    it('should omit env when envVars is empty', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      await executeContainerJob(baseOptions);

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      const container = jobDef.template.containers[0];
      expect(container.env).toBeUndefined();
    });

    it('should use custom timeout', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      await executeContainerJob({
        ...baseOptions,
        timeoutSeconds: 600,
      });

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      expect(jobDef.configuration.replicaTimeout).toBe(600);
    });
  });

  describe('ACR registry auth', () => {
    it('should configure registry credentials when acrLoginServer is provided', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      await executeContainerJob({
        ...baseOptions,
        acrLoginServer: 'myacr.azurecr.io',
      });

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      expect(jobDef.configuration.secrets).toEqual([
        { name: 'acr-password', value: 'test-client-secret' },
      ]);
      expect(jobDef.configuration.registries).toEqual([
        {
          server: 'myacr.azurecr.io',
          username: 'test-client-id',
          passwordSecretRef: 'acr-password',
        },
      ]);
    });

    it('should not configure registry when acrLoginServer is not provided', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      await executeContainerJob(baseOptions);

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      expect(jobDef.configuration.secrets).toBeUndefined();
      expect(jobDef.configuration.registries).toBeUndefined();
    });
  });

  describe('Error cases', () => {
    it('should return failure when job creation fails with non-transient error', async () => {
      mockBeginCreateOrUpdateAndWait.mockRejectedValue(
        new Error('Insufficient permissions'),
      );

      const result = await executeContainerJob(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient permissions');
      expect(mockBeginStartAndWait).not.toHaveBeenCalled();
      expect(mockBeginCreateOrUpdateAndWait).toHaveBeenCalledTimes(1);
    });

    it('should return generic error when creation error has no message', async () => {
      mockBeginCreateOrUpdateAndWait.mockRejectedValue({});

      const result = await executeContainerJob(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error creating Container Apps Job');
    });
  });

  describe('Retry on transient errors', () => {
    it('should retry beginCreateOrUpdateAndWait on network error and succeed', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait
        .mockRejectedValueOnce(
          new Error('network_error: Network request failed'),
        )
        .mockResolvedValueOnce({});
      mockBeginStartAndWait.mockResolvedValue({});

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mockBeginCreateOrUpdateAndWait).toHaveBeenCalledTimes(2);
    });

    it('should retry beginStartAndWait on network error and succeed', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait
        .mockRejectedValueOnce(
          new Error('network_error: Network request failed'),
        )
        .mockResolvedValueOnce({});

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.logs).toBe('Job completed successfully');
      expect(mockBeginStartAndWait).toHaveBeenCalledTimes(2);
    });

    it('should not retry non-transient errors', async () => {
      mockBeginStartAndWait.mockRejectedValue(new Error('Bad request'));
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      rs.mocked(pollContainerJobStatus).mockResolvedValue({
        status: 'Succeeded',
      });

      const result = await executeContainerJob(baseOptions);

      expect(mockBeginStartAndWait).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('should retry on ETIMEDOUT errors', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({});
      mockBeginStartAndWait.mockResolvedValue({});

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mockBeginCreateOrUpdateAndWait).toHaveBeenCalledTimes(2);
    });

    it('should retry on ECONNRESET errors', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce({});

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mockBeginStartAndWait).toHaveBeenCalledTimes(2);
    });

    it('should fail after exhausting all retries for create', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockRejectedValue(
        new Error('network_error: Network request failed'),
      );

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('network_error: Network request failed');
      expect(mockBeginCreateOrUpdateAndWait).toHaveBeenCalledTimes(3);
      expect(mockBeginStartAndWait).not.toHaveBeenCalled();
    });
  });

  describe('LRO polling fallback', () => {
    it('should recover when beginStartAndWait fails but job succeeded', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockRejectedValue(
        new Error('network_error: Network request failed'),
      );
      rs.mocked(pollContainerJobStatus).mockResolvedValue({
        status: 'Succeeded',
        executionName: 'migrate-auth-service-abc123',
      });

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.logs).toContain('recovered from polling error');
      expect(mockBeginStartAndWait).toHaveBeenCalledTimes(3);
    });

    it('should report failure when job genuinely failed', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockRejectedValue(
        new Error('network_error: Network request failed'),
      );
      rs.mocked(pollContainerJobStatus).mockResolvedValue({
        status: 'Failed',
        executionName: 'migrate-auth-service-abc123',
      });

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job execution status: Failed');
    });

    it('should report original error when fallback verification also fails', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockRejectedValue(
        new Error('network_error: Network request failed'),
      );
      rs.mocked(pollContainerJobStatus).mockRejectedValue(
        new Error('SDK client also broken'),
      );

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('network_error: Network request failed');
    });

    it('should pass correct args to pollContainerJobStatus', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockRejectedValue(new Error('polling failed'));
      rs.mocked(pollContainerJobStatus).mockResolvedValue({
        status: 'Succeeded',
      });

      await executeContainerJob({
        ...baseOptions,
        timeoutSeconds: 600,
      });

      expect(pollContainerJobStatus).toHaveBeenCalledWith(
        expect.anything(),
        'test-rg',
        'migrate-auth-service',
        600,
      );
    });

    it('should not call pollContainerJobStatus when beginStartAndWait succeeds', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockBeginStartAndWait.mockResolvedValue({});

      await executeContainerJob(baseOptions);

      expect(pollContainerJobStatus).not.toHaveBeenCalled();
    });
  });
});
