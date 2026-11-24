/**
 * Tests for execute-container-job
 */

import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';

const mockBeginCreateOrUpdateAndWait = rs.fn();
// jobs.start(): the start request (submitted), then the wait (pollUntilDone)
const mockStart = rs.fn();
const mockSubmitted = rs.fn();
const mockPollUntilDone = rs.fn();
const mockBuildAcrAuthConfig = rs.fn();

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

// Mock infra-core (includes Azure credential helper and ACR auth)
rs.mock('@tsdevstack/infra-core', () => ({
  createAzureCredential: rs.fn(() => ({})),
  buildAcrAuthConfig: (...args: unknown[]) => mockBuildAcrAuthConfig(...args),
  toKebabCase: rs.fn((name: string) => name.toLowerCase().replace(/_/g, '-')),
}));

// Mock Azure Container Apps client
rs.mock('@azure/arm-appcontainers', () => ({
  ContainerAppsAPIClient: class MockContainerAppsAPIClient {
    jobs = {
      beginCreateOrUpdateAndWait: mockBeginCreateOrUpdateAndWait,
      start: (...args: unknown[]) => {
        mockStart(...args);
        return { submitted: mockSubmitted, pollUntilDone: mockPollUntilDone };
      },
    };
    constructor() {}
  },
}));

// Mock poll-container-job-status
rs.mock('./poll-container-job-status', () => ({
  pollContainerJobStatus: rs.fn(),
}));

// The newest execution before the start
rs.mock('./find-latest-job-execution', () => ({
  findLatestJobExecution: rs.fn(async () => ({ name: 'job-before' })),
}));

// The wait for the execution the start answered with
const mockWaitForJobExecution = rs.fn();
rs.mock('./wait-for-job-execution', () => ({
  waitForJobExecution: (...args: unknown[]) => mockWaitForJobExecution(...args),
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
    mockSubmitted.mockResolvedValue(undefined);
    mockWaitForJobExecution.mockResolvedValue({ status: 'Succeeded' });
    // Default: no ACR auth (no acrLoginServer)
    mockBuildAcrAuthConfig.mockResolvedValue({
      registries: undefined,
      identity: undefined,
      secrets: [],
    });
  });

  afterEach(() => {
    rs.useRealTimers();
  });

  describe('Standard use cases', () => {
    it('should return success when job completes', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      const result = await executeContainerJob(baseOptions);

      expect(result.success).toBe(true);
      expect(result.logs).toBe('Job completed successfully');
    });

    it('should create job with correct configuration', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

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

    it('should let Azure start the run again only when asked to', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      await executeContainerJob({ ...baseOptions, retries: 1 });

      expect(
        mockBeginCreateOrUpdateAndWait.mock.calls[0][2].configuration
          .replicaRetryLimit,
      ).toBe(1);
    });

    it('should start the job after creating it, then wait for it', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      await executeContainerJob(baseOptions);

      expect(mockStart).toHaveBeenCalledWith(
        'test-rg',
        'migrate-auth-service',
        {},
      );
      expect(mockPollUntilDone).toHaveBeenCalledTimes(1);
    });

    it('should pass env vars to container', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

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
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      await executeContainerJob(baseOptions);

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      const container = jobDef.template.containers[0];
      expect(container.env).toBeUndefined();
    });

    it('should use custom timeout', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      await executeContainerJob({
        ...baseOptions,
        timeoutSeconds: 600,
      });

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      expect(jobDef.configuration.replicaTimeout).toBe(600);
    });
  });

  describe('Managed identity ACR auth', () => {
    it('should use managed identity for registry when acrManagedIdentityId is provided', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });
      mockBuildAcrAuthConfig.mockResolvedValue({
        registries: [
          {
            server: 'myacr.azurecr.io',
            identity: '/subscriptions/sub/identity/ca-id',
          },
        ],
        identity: {
          type: 'UserAssigned',
          userAssignedIdentities: {
            '/subscriptions/sub/identity/ca-id': {},
          },
        },
        secrets: [],
      });

      await executeContainerJob({
        ...baseOptions,
        acrLoginServer: 'myacr.azurecr.io',
        acrManagedIdentityId: '/subscriptions/sub/identity/ca-id',
      });

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      expect(jobDef.configuration.registries).toEqual([
        {
          server: 'myacr.azurecr.io',
          identity: '/subscriptions/sub/identity/ca-id',
        },
      ]);
      expect(jobDef.identity).toEqual({
        type: 'UserAssigned',
        userAssignedIdentities: {
          '/subscriptions/sub/identity/ca-id': {},
        },
      });
    });

    it('should not include acr-password secret when using managed identity', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });
      mockBuildAcrAuthConfig.mockResolvedValue({
        registries: [
          {
            server: 'myacr.azurecr.io',
            identity: '/subscriptions/sub/identity/ca-id',
          },
        ],
        identity: {
          type: 'UserAssigned',
          userAssignedIdentities: {
            '/subscriptions/sub/identity/ca-id': {},
          },
        },
        secrets: [],
      });

      await executeContainerJob({
        ...baseOptions,
        acrLoginServer: 'myacr.azurecr.io',
        acrManagedIdentityId: '/subscriptions/sub/identity/ca-id',
      });

      const callArgs = mockBeginCreateOrUpdateAndWait.mock.calls[0];
      const jobDef = callArgs[2];
      expect(jobDef.configuration.secrets).toBeUndefined();
    });
  });

  describe('Key Vault env vars', () => {
    const SECRET_URL =
      'https://shop-dev-dbjobs.vault.azure.net/secrets/shop-auth-service-MIGRATION-DATABASE-URL';
    const ACR_IDENTITY = '/subscriptions/sub/identity/ca-id';
    const DB_JOBS_IDENTITY = '/subscriptions/sub/identity/db-jobs';

    beforeEach(() => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });
    });

    it('should have Container Apps fetch the secret, with no value in the job', async () => {
      await executeContainerJob({
        ...baseOptions,
        keyVaultEnvVars: [{ name: 'DATABASE_URL', keyVaultUrl: SECRET_URL }],
        secretsIdentityId: DB_JOBS_IDENTITY,
      });

      const jobDef = mockBeginCreateOrUpdateAndWait.mock.calls[0][2];
      expect(jobDef.configuration.secrets).toEqual([
        {
          name: 'database-url',
          keyVaultUrl: SECRET_URL,
          identity: DB_JOBS_IDENTITY,
        },
      ]);
      expect(jobDef.template.containers[0].env).toEqual([
        { name: 'DATABASE_URL', secretRef: 'database-url' },
      ]);
      expect(JSON.stringify(jobDef)).not.toContain('postgres');
    });

    it("should keep the secrets identity from the container's code", async () => {
      await executeContainerJob({
        ...baseOptions,
        keyVaultEnvVars: [{ name: 'DATABASE_URL', keyVaultUrl: SECRET_URL }],
        secretsIdentityId: DB_JOBS_IDENTITY,
      });

      const jobDef = mockBeginCreateOrUpdateAndWait.mock.calls[0][2];
      expect(jobDef.configuration.identitySettings).toEqual([
        { identity: DB_JOBS_IDENTITY, lifecycle: 'None' },
      ]);
    });

    it('should leave identity settings alone without a secrets identity', async () => {
      await executeContainerJob(baseOptions);

      const jobDef = mockBeginCreateOrUpdateAndWait.mock.calls[0][2];
      expect(jobDef.configuration.identitySettings).toBeUndefined();
    });

    it('should attach the secrets identity next to the ACR one', async () => {
      mockBuildAcrAuthConfig.mockResolvedValue({
        registries: [{ server: 'myacr.azurecr.io', identity: ACR_IDENTITY }],
        identity: {
          type: 'UserAssigned',
          userAssignedIdentities: { [ACR_IDENTITY]: {} },
        },
        secrets: [],
      });

      await executeContainerJob({
        ...baseOptions,
        acrLoginServer: 'myacr.azurecr.io',
        acrManagedIdentityId: ACR_IDENTITY,
        keyVaultEnvVars: [{ name: 'DATABASE_URL', keyVaultUrl: SECRET_URL }],
        secretsIdentityId: DB_JOBS_IDENTITY,
      });

      const jobDef = mockBeginCreateOrUpdateAndWait.mock.calls[0][2];
      expect(jobDef.identity).toEqual({
        type: 'UserAssigned',
        userAssignedIdentities: {
          [ACR_IDENTITY]: {},
          [DB_JOBS_IDENTITY]: {},
        },
      });
      // The image is still pulled with the ACR identity
      expect(jobDef.configuration.registries).toEqual([
        { server: 'myacr.azurecr.io', identity: ACR_IDENTITY },
      ]);
    });

    it('should keep plain env vars next to the Key Vault ones', async () => {
      await executeContainerJob({
        ...baseOptions,
        envVars: [{ name: 'LOG_LEVEL', value: 'info' }],
        keyVaultEnvVars: [{ name: 'DATABASE_URL', keyVaultUrl: SECRET_URL }],
        secretsIdentityId: DB_JOBS_IDENTITY,
      });

      const jobDef = mockBeginCreateOrUpdateAndWait.mock.calls[0][2];
      expect(jobDef.template.containers[0].env).toEqual([
        { name: 'LOG_LEVEL', value: 'info' },
        { name: 'DATABASE_URL', secretRef: 'database-url' },
      ]);
    });

    it('should keep the ACR password secret with password auth', async () => {
      mockBuildAcrAuthConfig.mockResolvedValue({
        registries: [
          {
            server: 'myacr.azurecr.io',
            username: 'test-client-id',
            passwordSecretRef: 'acr-password',
          },
        ],
        identity: undefined,
        secrets: [{ name: 'acr-password', value: 'test-client-secret' }],
      });

      await executeContainerJob({
        ...baseOptions,
        acrLoginServer: 'myacr.azurecr.io',
        keyVaultEnvVars: [{ name: 'DATABASE_URL', keyVaultUrl: SECRET_URL }],
        secretsIdentityId: DB_JOBS_IDENTITY,
      });

      const jobDef = mockBeginCreateOrUpdateAndWait.mock.calls[0][2];
      expect(jobDef.configuration.secrets).toEqual([
        { name: 'acr-password', value: 'test-client-secret' },
        {
          name: 'database-url',
          keyVaultUrl: SECRET_URL,
          identity: DB_JOBS_IDENTITY,
        },
      ]);
      expect(jobDef.identity).toEqual({
        type: 'UserAssigned',
        userAssignedIdentities: { [DB_JOBS_IDENTITY]: {} },
      });
    });

    it('should fail without an identity to read the secrets with', async () => {
      const result = await executeContainerJob({
        ...baseOptions,
        keyVaultEnvVars: [{ name: 'DATABASE_URL', keyVaultUrl: SECRET_URL }],
      });

      expect(result).toEqual({
        success: false,
        logs: '',
        error: 'Key Vault env vars need secretsIdentityId to be read with',
      });
      expect(mockBeginCreateOrUpdateAndWait).not.toHaveBeenCalled();
    });
  });

  describe('ACR registry auth', () => {
    it('should configure registry credentials when acrLoginServer is provided', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });
      mockBuildAcrAuthConfig.mockResolvedValue({
        registries: [
          {
            server: 'myacr.azurecr.io',
            username: 'test-client-id',
            passwordSecretRef: 'acr-password',
          },
        ],
        identity: undefined,
        secrets: [{ name: 'acr-password', value: 'test-client-secret' }],
      });

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
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

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
      expect(mockPollUntilDone).not.toHaveBeenCalled();
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
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mockBeginCreateOrUpdateAndWait).toHaveBeenCalledTimes(2);
    });

    it('should send the start again after a network error', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockSubmitted
        .mockRejectedValueOnce(
          new Error('network_error: Network request failed'),
        )
        .mockResolvedValueOnce(undefined);
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.logs).toBe('Job completed successfully');
      expect(mockStart).toHaveBeenCalledTimes(2);
    });

    it('should fail at once when the start is refused, without checking older executions', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockSubmitted.mockRejectedValue(new Error('Bad request'));

      const result = await executeContainerJob(baseOptions);

      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: false,
        logs: '',
        error: 'Bad request',
      });
      expect(pollContainerJobStatus).not.toHaveBeenCalled();
    });

    it('should retry on ETIMEDOUT errors', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait
        .mockRejectedValueOnce(new Error('ETIMEDOUT'))
        .mockResolvedValueOnce({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mockBeginCreateOrUpdateAndWait).toHaveBeenCalledTimes(2);
    });

    it('should retry the start on ECONNRESET errors', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockSubmitted
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(undefined);
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(mockStart).toHaveBeenCalledTimes(2);
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
      expect(mockStart).not.toHaveBeenCalled();
    });
  });

  describe('LRO polling fallback', () => {
    it('should check the status, not start again, when the wait loses its connection', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockRejectedValue(
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
      expect(mockStart).toHaveBeenCalledTimes(1);
      expect(mockPollUntilDone).toHaveBeenCalledTimes(1);
    });

    it('should report failure when job genuinely failed', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockRejectedValue(
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
      mockPollUntilDone.mockRejectedValue(
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
      mockPollUntilDone.mockRejectedValue(new Error('polling failed'));
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
        // The job's timeout plus the time before its container runs
        900,
        // Never taken for this start's execution
        'job-before',
      );
    });

    it("should check the newest execution when the start's answer has no name", async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({});
      rs.mocked(pollContainerJobStatus).mockResolvedValue({
        status: 'Succeeded',
      });

      const result = await executeContainerJob(baseOptions);

      expect(mockWaitForJobExecution).not.toHaveBeenCalled();
      expect(pollContainerJobStatus).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('should check the status when every start lost its answer', async () => {
      rs.useFakeTimers();

      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockSubmitted.mockRejectedValue(new Error('ETIMEDOUT'));
      rs.mocked(pollContainerJobStatus).mockResolvedValue({
        status: 'NotStarted',
      });

      const resultPromise = executeContainerJob(baseOptions);
      await rs.runAllTimersAsync();
      const result = await resultPromise;

      expect(mockStart).toHaveBeenCalledTimes(3);
      expect(mockPollUntilDone).not.toHaveBeenCalled();
      expect(result).toEqual({
        success: false,
        logs: '',
        error: 'Job execution status: NotStarted',
      });
    });

    it('should not call pollContainerJobStatus when the wait succeeds', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      await executeContainerJob(baseOptions);

      expect(pollContainerJobStatus).not.toHaveBeenCalled();
    });
  });

  describe('The execution after the start', () => {
    it('should wait for the execution the start answered with', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });

      await executeContainerJob({ ...baseOptions, timeoutSeconds: 600 });

      expect(mockWaitForJobExecution).toHaveBeenCalledWith(
        expect.anything(),
        'test-rg',
        'migrate-auth-service',
        'exec-1',
        900,
      );
    });

    it('should report failure when the execution fails after a successful start', async () => {
      // Azure's start ends when the execution exists: a migration that fails
      // a few seconds later must still fail the job
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });
      mockWaitForJobExecution.mockResolvedValue({
        status: 'Failed',
        detail: 'Job has reached the specified backoff limit',
      });

      const result = await executeContainerJob(baseOptions);

      expect(result).toEqual({
        success: false,
        logs: '',
        error:
          'Job execution exec-1: Failed (Job has reached the specified backoff limit)',
      });
      expect(pollContainerJobStatus).not.toHaveBeenCalled();
    });

    it('should report failure when the execution still runs at the deadline', async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });
      mockWaitForJobExecution.mockResolvedValue({ status: 'TimedOut' });

      const result = await executeContainerJob(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Job execution exec-1: TimedOut');
    });

    it("should report failure when the execution's status can't be read", async () => {
      mockBeginCreateOrUpdateAndWait.mockResolvedValue({});
      mockPollUntilDone.mockResolvedValue({ name: 'exec-1' });
      mockWaitForJobExecution.mockRejectedValue(new Error('ECONNRESET'));

      const result = await executeContainerJob(baseOptions);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'Could not read the status of job execution exec-1: ECONNRESET',
      );
      expect(mockStart).toHaveBeenCalledTimes(1);
    });
  });
});
