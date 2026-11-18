import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockRead, mockGetTerraformOutput, mockGetIdentities } = rs.hoisted(
  () => ({
    mockRead: rs.fn(),
    mockGetTerraformOutput: rs.fn(),
    mockGetIdentities: rs.fn(),
  }),
);

rs.mock('./key-vault/read-key-vault-secret', () => ({
  readKeyVaultSecret: mockRead,
}));
rs.mock('./terraform', () => ({
  getTerraformOutput: mockGetTerraformOutput,
  getServiceSecretsIdentities: mockGetIdentities,
}));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { resolveAzureMigrationJobAccess } from './resolve-azure-migration-job-access';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

const credentials = {
  subscriptionId: 's',
  tenantId: 't',
  clientId: 'c',
  clientSecret: 'x',
  location: 'swedencentral',
};

const options = {
  projectName: 'shop',
  targetEnv: 'dev',
  serviceName: 'auth-service',
  credentials,
  terraformDir: '/p/infrastructure/terraform/dev',
  tfEnv: { ARM_CLIENT_ID: 'c' },
};

const DB_JOBS_IDENTITY =
  '/subscriptions/s/resourceGroups/shop-dev-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/shop-dev-db-jobs';
const SERVICE_IDENTITY =
  '/subscriptions/s/resourceGroups/shop-dev-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/shop-dev-auth-service-secrets';

describe('resolveAzureMigrationJobAccess', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.keyVaultExists.mockResolvedValue(true);
    mocks.resolveKeyVaultName.mockImplementation(
      async (_c: unknown, project: string, env: string, scope?: string) =>
        `${project}-${env}-${scope}`,
    );
    mockRead.mockResolvedValue('postgresql://u:p@h:5432/db');
    mockGetTerraformOutput.mockReturnValue(DB_JOBS_IDENTITY);
    mockGetIdentities.mockReturnValue({
      'auth-service': { id: SERVICE_IDENTITY, client_id: 'svc-client' },
    });
  });

  describe('Standard use cases', () => {
    it("should read the owner's URL from the database jobs' vault as the database jobs' identity", async () => {
      await expect(resolveAzureMigrationJobAccess(options)).resolves.toEqual({
        keyVaultSecretUrl:
          'https://shop-dev-dbjobs.vault.azure.net/secrets/shop-auth-service-MIGRATION-DATABASE-URL',
        identityId: DB_JOBS_IDENTITY,
      });
      expect(mocks.keyVaultExists).toHaveBeenCalledWith(
        credentials,
        'shop',
        'dev',
        'dbjobs',
      );
      expect(mockRead).toHaveBeenCalledWith({
        credentials,
        vaultName: 'shop-dev-dbjobs',
        secretName: 'shop-auth-service-MIGRATION-DATABASE-URL',
      });
      expect(mockGetTerraformOutput).toHaveBeenCalledWith(
        options.terraformDir,
        'db_jobs_identity_id',
        options.tfEnv,
      );
      expect(mockGetIdentities).not.toHaveBeenCalled();
    });

    it("should fall back to the service's DATABASE_URL and identity when there is no database jobs' vault", async () => {
      mocks.keyVaultExists.mockResolvedValue(false);

      await expect(resolveAzureMigrationJobAccess(options)).resolves.toEqual({
        keyVaultSecretUrl:
          'https://shop-dev-auth-service.vault.azure.net/secrets/shop-auth-service-DATABASE-URL',
        identityId: SERVICE_IDENTITY,
      });
      expect(mockRead).toHaveBeenCalledTimes(1);
      expect(mockRead).toHaveBeenCalledWith({
        credentials,
        vaultName: 'shop-dev-auth-service',
        secretName: 'shop-auth-service-DATABASE-URL',
      });
      expect(mockGetIdentities).toHaveBeenCalledWith(
        options.terraformDir,
        options.tfEnv,
      );
      expect(mockGetTerraformOutput).not.toHaveBeenCalled();
    });

    it("should fall back when the database jobs' vault has no URL for the service yet", async () => {
      mockRead.mockResolvedValueOnce(null);

      const access = await resolveAzureMigrationJobAccess(options);

      expect(access?.identityId).toBe(SERVICE_IDENTITY);
      expect(access?.keyVaultSecretUrl).toContain(
        'shop-dev-auth-service.vault.azure.net',
      );
    });
  });

  describe('Edge cases', () => {
    it('should return null when neither secret exists', async () => {
      mocks.keyVaultExists.mockResolvedValue(false);
      mockRead.mockResolvedValue(null);

      await expect(resolveAzureMigrationJobAccess(options)).resolves.toBeNull();
      expect(mockGetIdentities).not.toHaveBeenCalled();
    });

    it('should fail when the service has no Key Vault identity', async () => {
      mocks.keyVaultExists.mockResolvedValue(false);
      mockGetIdentities.mockReturnValue({});

      await expect(resolveAzureMigrationJobAccess(options)).rejects.toThrow(
        'No Key Vault identity for auth-service in the Terraform outputs',
      );
    });

    it('should pass a Key Vault error on (no access)', async () => {
      mockRead.mockRejectedValue(
        Object.assign(new Error('Forbidden'), { statusCode: 403 }),
      );

      await expect(resolveAzureMigrationJobAccess(options)).rejects.toThrow(
        'Forbidden',
      );
    });
  });
});
