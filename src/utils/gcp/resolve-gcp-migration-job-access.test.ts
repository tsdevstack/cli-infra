import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockGetSecret, mockGetTerraformOutputJson } = rs.hoisted(() => ({
  mockGetSecret: rs.fn(),
  mockGetTerraformOutputJson: rs.fn(),
}));

rs.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class {
    getSecret = mockGetSecret;
  },
}));
rs.mock('./terraform', () => ({
  getTerraformOutputJson: mockGetTerraformOutputJson,
}));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { resolveGcpMigrationJobAccess } from './resolve-gcp-migration-job-access';

const options = {
  projectName: 'shop',
  serviceName: 'auth-service',
  credentials: {
    project_id: 'gcp-shop',
    region: 'europe-west1',
    client_email: 'x@gcp-shop.iam.gserviceaccount.com',
    private_key: 'k',
  },
  terraformDir: '/p/infrastructure/terraform/dev',
  tfEnv: {},
  runtimeServiceAccount:
    'shop-auth-service-rt@gcp-shop.iam.gserviceaccount.com',
};

describe('resolveGcpMigrationJobAccess', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockGetTerraformOutputJson.mockReturnValue({
      'auth-service': 'shop-auth-service-mg@gcp-shop.iam.gserviceaccount.com',
      'offers-service':
        'shop-offers-service-mg@gcp-shop.iam.gserviceaccount.com',
    });
  });

  describe('Standard use cases', () => {
    it("should run as the service's migration account with the owner's URL", async () => {
      mockGetSecret.mockResolvedValue([{}]);

      await expect(resolveGcpMigrationJobAccess(options)).resolves.toEqual({
        secretName: 'shop-auth-service-MIGRATION_DATABASE_URL',
        serviceAccount: 'shop-auth-service-mg@gcp-shop.iam.gserviceaccount.com',
      });
      expect(mockGetSecret).toHaveBeenCalledWith({
        name: 'projects/gcp-shop/secrets/shop-auth-service-MIGRATION_DATABASE_URL',
      });
      expect(mockGetTerraformOutputJson).toHaveBeenCalledWith(
        options.terraformDir,
        'migration_service_account_emails',
        options.tfEnv,
      );
    });

    it("should keep DATABASE_URL and the service's account in an environment not converted yet", async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('NOT_FOUND'), { code: 5 }),
      );

      await expect(resolveGcpMigrationJobAccess(options)).resolves.toEqual({
        secretName: 'shop-auth-service-DATABASE_URL',
        serviceAccount: options.runtimeServiceAccount,
      });
      expect(mockGetTerraformOutputJson).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should stop when the service has no migration account yet', async () => {
      mockGetSecret.mockResolvedValue([{}]);
      mockGetTerraformOutputJson.mockReturnValue({});

      await expect(resolveGcpMigrationJobAccess(options)).rejects.toMatchObject(
        {
          name: 'CliError',
          message:
            'No migration service account for auth-service in the Terraform outputs',
        },
      );
    });

    it('should stop on any other error rather than guess', async () => {
      mockGetSecret.mockRejectedValue(
        Object.assign(new Error('PERMISSION_DENIED'), { code: 7 }),
      );

      await expect(resolveGcpMigrationJobAccess(options)).rejects.toMatchObject(
        {
          name: 'CliError',
          message:
            'Could not check the secret shop-auth-service-MIGRATION_DATABASE_URL',
        },
      );
    });
  });
});
