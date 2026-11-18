import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockSend } = rs.hoisted(() => ({ mockSend: rs.fn() }));

rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send = mockSend;
  },
  DescribeSecretCommand: class {
    constructor(readonly input: { SecretId: string }) {}
  },
}));

import { resolveAwsMigrationSecretName } from './resolve-aws-migration-secret-name';

const options = {
  projectName: 'shop',
  serviceName: 'auth-service',
  credentials: {
    accountId: '123456789012',
    accessKeyId: 'k',
    secretAccessKey: 's',
    region: 'eu-west-1',
  },
};

describe('resolveAwsMigrationSecretName', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should pick the owner role's MIGRATION_DATABASE_URL when it exists", async () => {
      mockSend.mockResolvedValue({ Name: 'x' });

      await expect(resolveAwsMigrationSecretName(options)).resolves.toBe(
        'shop-auth-service-MIGRATION_DATABASE_URL',
      );
      expect(mockSend.mock.calls[0][0].input).toEqual({
        SecretId: 'shop-auth-service-MIGRATION_DATABASE_URL',
      });
    });

    it('should fall back to DATABASE_URL in an environment db-init has not converted', async () => {
      mockSend.mockRejectedValue(
        Object.assign(new Error('not found'), {
          name: 'ResourceNotFoundException',
        }),
      );

      await expect(resolveAwsMigrationSecretName(options)).resolves.toBe(
        'shop-auth-service-DATABASE_URL',
      );
    });
  });

  describe('Edge cases', () => {
    it('should stop on any other error rather than guess', async () => {
      mockSend.mockRejectedValue(
        Object.assign(new Error('User is not authorized'), {
          name: 'AccessDeniedException',
        }),
      );

      await expect(
        resolveAwsMigrationSecretName(options),
      ).rejects.toMatchObject({
        name: 'CliError',
        message:
          'Could not check the secret shop-auth-service-MIGRATION_DATABASE_URL',
      });
    });
  });
});
