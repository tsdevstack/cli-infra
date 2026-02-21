import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { deleteSharedSecretsForService } from './delete-shared-secrets-for-service';

// Mock @google-cloud/secret-manager
const mockDeleteSecret = rs.fn();
rs.mock('@google-cloud/secret-manager', () => {
  return {
    SecretManagerServiceClient: class MockSecretManagerServiceClient {
      deleteSecret = mockDeleteSecret;
    },
  };
});

// Mock context
rs.mock('../../../context', () => ({
  getContext: () => ({
    buildGCPClientOptions: (creds: unknown) => ({
      projectId: (creds as { project_id: string }).project_id,
    }),
    logger: {
      warn: rs.fn(),
    },
  }),
}));

describe('deleteSharedSecretsForService', () => {
  const mockCredentials = {
    project_id: 'test-project',
    region: 'us-central1',
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: 'mock-key',
  };

  beforeEach(() => {
    rs.clearAllMocks();
    mockDeleteSecret.mockResolvedValue({});
  });

  describe('Service without database', () => {
    it('should delete URL and API key secrets', async () => {
      const result = await deleteSharedSecretsForService({
        projectId: 'test-project',
        projectName: 'tsdevstack',
        serviceName: 'test-service',
        hasDatabase: false,
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toHaveLength(2);
      expect(mockDeleteSecret).toHaveBeenCalledTimes(2);

      // Check the secrets being deleted
      // URL/API_KEY use full name: test-service -> TEST_SERVICE
      const calls = mockDeleteSecret.mock.calls;
      expect(calls[0][0].name).toBe(
        'projects/test-project/secrets/tsdevstack-shared-TEST_SERVICE_URL',
      );
      expect(calls[1][0].name).toBe(
        'projects/test-project/secrets/tsdevstack-shared-TEST_SERVICE_API_KEY',
      );
    });
  });

  describe('Service with database', () => {
    it('should delete URL, API key, and database secrets', async () => {
      const result = await deleteSharedSecretsForService({
        projectId: 'test-project',
        projectName: 'tsdevstack',
        serviceName: 'auth-service',
        hasDatabase: true,
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toHaveLength(4);
      expect(mockDeleteSecret).toHaveBeenCalledTimes(4);

      // Check the secrets being deleted
      // URL/API_KEY use full name: auth-service -> AUTH_SERVICE
      // DB secrets strip -service: auth-service -> AUTH
      const calls = mockDeleteSecret.mock.calls;
      expect(calls[0][0].name).toBe(
        'projects/test-project/secrets/tsdevstack-shared-AUTH_SERVICE_URL',
      );
      expect(calls[1][0].name).toBe(
        'projects/test-project/secrets/tsdevstack-shared-AUTH_SERVICE_API_KEY',
      );
      expect(calls[2][0].name).toBe(
        'projects/test-project/secrets/tsdevstack-shared-DB_AUTH_PASSWORD',
      );
      expect(calls[3][0].name).toBe(
        'projects/test-project/secrets/tsdevstack-shared-DB_AUTH_USERNAME',
      );
    });
  });

  describe('Idempotency', () => {
    it('should treat NOT_FOUND as success (already gone)', async () => {
      mockDeleteSecret
        .mockRejectedValueOnce(new Error('5 NOT_FOUND: Secret not found'))
        .mockRejectedValueOnce(new Error('5 NOT_FOUND: Secret not found'));

      const result = await deleteSharedSecretsForService({
        projectId: 'test-project',
        projectName: 'tsdevstack',
        serviceName: 'test-service',
        hasDatabase: false,
        credentials: mockCredentials,
      });

      expect(result.success).toBe(true);
      expect(result.deleted).toHaveLength(0);
      expect(result.alreadyGone).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('Error handling', () => {
    it('should track failed deletions', async () => {
      mockDeleteSecret
        .mockResolvedValueOnce({}) // URL deleted successfully
        .mockRejectedValueOnce(new Error('Permission denied')); // API key fails

      const result = await deleteSharedSecretsForService({
        projectId: 'test-project',
        projectName: 'tsdevstack',
        serviceName: 'test-service',
        hasDatabase: false,
        credentials: mockCredentials,
      });

      expect(result.success).toBe(false);
      expect(result.deleted).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.error).toBe('Failed to delete 1 secret(s)');
    });
  });

  describe('Service name transformation', () => {
    it('should correctly transform kebab-case with different rules for URL/API_KEY vs DB secrets', async () => {
      await deleteSharedSecretsForService({
        projectId: 'test-project',
        projectName: 'myproject',
        serviceName: 'order-processing-service',
        hasDatabase: true,
        credentials: mockCredentials,
      });

      const calls = mockDeleteSecret.mock.calls;
      // URL/API_KEY use full name: order-processing-service -> ORDER_PROCESSING_SERVICE
      expect(calls[0][0].name).toBe(
        'projects/test-project/secrets/myproject-shared-ORDER_PROCESSING_SERVICE_URL',
      );
      expect(calls[1][0].name).toBe(
        'projects/test-project/secrets/myproject-shared-ORDER_PROCESSING_SERVICE_API_KEY',
      );
      // DB secrets strip -service: order-processing-service -> ORDER_PROCESSING
      expect(calls[2][0].name).toBe(
        'projects/test-project/secrets/myproject-shared-DB_ORDER_PROCESSING_PASSWORD',
      );
      expect(calls[3][0].name).toBe(
        'projects/test-project/secrets/myproject-shared-DB_ORDER_PROCESSING_USERNAME',
      );
    });
  });
});
