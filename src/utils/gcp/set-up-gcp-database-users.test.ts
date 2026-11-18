import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const {
  mockSetSecretViaCli,
  mockEnsure,
  mockBuildAndPush,
  mockRunDbInit,
  mockGetTerraformOutput,
  calls,
} = rs.hoisted(() => {
  const calls: string[] = [];
  return {
    calls,
    mockSetSecretViaCli: rs.fn(() => calls.push('secret')),
    mockEnsure: rs.fn(async () => calls.push('ensure')),
    mockBuildAndPush: rs.fn(async () => calls.push('build')),
    mockRunDbInit: rs.fn(async () => calls.push('run')),
    mockGetTerraformOutput: rs.fn(),
  };
});

rs.mock('../credentials/set-secret-via-cli', () => ({
  setSecretViaCli: mockSetSecretViaCli,
}));
rs.mock('./ensure-gcp-database-url-secrets', () => ({
  ensureGcpDatabaseUrlSecrets: mockEnsure,
}));
rs.mock('./build-and-push-gcp-db-init', () => ({
  buildAndPushGcpDbInit: mockBuildAndPush,
}));
rs.mock('./run-gcp-db-init', () => ({ runGcpDbInit: mockRunDbInit }));
rs.mock('./terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { setUpGcpDatabaseUsers } from './set-up-gcp-database-users';

const credentials = {
  project_id: 'gcp-shop',
  region: 'europe-west1',
  client_email: 'x@gcp-shop.iam.gserviceaccount.com',
  private_key: 'k',
};

const options = {
  terraformDir: '/p/infrastructure/terraform/dev',
  tfEnv: {},
  projectName: 'shop',
  targetEnv: 'dev',
  credentials,
  ownerPasswords: { 'auth-service': 'a+b/c', 'offers-service': 'pw' },
};

describe('setUpGcpDatabaseUsers', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    calls.length = 0;
    mockGetTerraformOutput.mockImplementation((_dir: string, name: string) =>
      name === 'database_private_ip'
        ? '10.20.0.3'
        : 'europe-west1-docker.pkg.dev/gcp-shop/shop',
    );
  });

  describe('Standard use cases', () => {
    it("should write each owner's MIGRATION_DATABASE_URL with Terraform's password", async () => {
      await setUpGcpDatabaseUsers(options);

      expect(mockSetSecretViaCli.mock.calls).toEqual([
        [
          'MIGRATION_DATABASE_URL',
          'postgresql://auth-service:a%2Bb%2Fc@10.20.0.3:5432/auth-service',
          'dev',
          'auth-service',
        ],
        [
          'MIGRATION_DATABASE_URL',
          'postgresql://offers-service:pw@10.20.0.3:5432/offers-service',
          'dev',
          'offers-service',
        ],
      ]);
    });

    it('should then create missing DATABASE_URL secrets, push db-init and run it', async () => {
      await setUpGcpDatabaseUsers(options);

      expect(calls).toEqual(['secret', 'secret', 'ensure', 'build', 'run']);
      expect(mockEnsure).toHaveBeenCalledWith({
        projectName: 'shop',
        credentials,
        serviceNames: ['auth-service', 'offers-service'],
      });
      expect(mockBuildAndPush).toHaveBeenCalledWith({
        dbInitDir: '/p/infrastructure/terraform/dev/db-init',
        imageUri: 'europe-west1-docker.pkg.dev/gcp-shop/shop/db-init:latest',
        credentials,
      });
      expect(mockRunDbInit).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'init',
          serviceNames: ['auth-service', 'offers-service'],
        }),
      );
    });
  });

  describe('Edge cases', () => {
    it('should stop before db-init when a secret cannot be written', async () => {
      mockSetSecretViaCli.mockImplementationOnce(() => {
        throw new Error('quota');
      });

      await expect(setUpGcpDatabaseUsers(options)).rejects.toMatchObject({
        name: 'CliError',
        message: 'Could not write MIGRATION_DATABASE_URL for auth-service',
      });
      expect(mockRunDbInit).not.toHaveBeenCalled();
    });
  });
});
