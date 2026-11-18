import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockGetSecret, mockCreateSecret } = rs.hoisted(() => ({
  mockGetSecret: rs.fn(),
  mockCreateSecret: rs.fn(),
}));

rs.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {
    getSecret = mockGetSecret;
    createSecret = mockCreateSecret;
  },
}));

rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { ensureGcpDatabaseUrlSecrets } from './ensure-gcp-database-url-secrets';

const options = {
  projectName: 'shop',
  credentials: {
    project_id: 'gcp-shop',
    region: 'europe-west1',
    client_email: 'x@gcp-shop.iam.gserviceaccount.com',
    private_key: 'k',
  },
  serviceNames: ['auth-service', 'offers-service'],
};

const notFound = () => Object.assign(new Error('NOT_FOUND'), { code: 5 });

describe('ensureGcpDatabaseUrlSecrets', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should create a missing DATABASE_URL secret, empty, with the usual labels', async () => {
      mockGetSecret
        .mockRejectedValueOnce(notFound())
        .mockResolvedValueOnce([{}]);

      await ensureGcpDatabaseUrlSecrets(options);

      expect(mockGetSecret.mock.calls.map((call) => call[0])).toEqual([
        { name: 'projects/gcp-shop/secrets/shop-auth-service-DATABASE_URL' },
        { name: 'projects/gcp-shop/secrets/shop-offers-service-DATABASE_URL' },
      ]);
      expect(mockCreateSecret).toHaveBeenCalledTimes(1);
      expect(mockCreateSecret).toHaveBeenCalledWith({
        parent: 'projects/gcp-shop',
        secretId: 'shop-auth-service-DATABASE_URL',
        secret: {
          replication: { automatic: {} },
          labels: {
            'project-name': 'shop',
            'managed-by': 'tsdevstack',
            'secret-type': 'user',
          },
        },
      });
    });

    it('should leave existing secrets as they are', async () => {
      mockGetSecret.mockResolvedValue([{}]);

      await ensureGcpDatabaseUrlSecrets(options);

      expect(mockCreateSecret).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should stop on any other error', async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('PERMISSION_DENIED'), { code: 7 }),
      );

      await expect(ensureGcpDatabaseUrlSecrets(options)).rejects.toThrow(
        'PERMISSION_DENIED',
      );
      expect(mockCreateSecret).not.toHaveBeenCalled();
    });
  });
});
