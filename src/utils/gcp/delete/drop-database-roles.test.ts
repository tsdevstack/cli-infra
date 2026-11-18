import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockRunGcpDbInit, mockGetTerraformOutput } = rs.hoisted(() => ({
  mockRunGcpDbInit: rs.fn(),
  mockGetTerraformOutput: rs.fn(),
}));

rs.mock('../run-gcp-db-init', () => ({ runGcpDbInit: mockRunGcpDbInit }));
rs.mock('../terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: () => ({ GOOGLE_PROJECT: 'gcp-shop' }),
}));

import { dropDatabaseRoles } from './drop-database-roles';

const ctx = {
  projectRoot: '/p',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    project_id: 'gcp-shop',
    region: 'europe-west1',
    client_email: 'x@gcp-shop.iam.gserviceaccount.com',
    private_key: 'k',
  },
  runningInCI: false,
};

describe('dropDatabaseRoles', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockGetTerraformOutput.mockReturnValue(
      'shop-db-jobs@gcp-shop.iam.gserviceaccount.com',
    );
    mockRunGcpDbInit.mockResolvedValue(undefined);
  });

  describe('Standard use cases', () => {
    it("should run db-init's remove mode for the service", async () => {
      await expect(
        dropDatabaseRoles({ ctx, serviceName: 'auth-service' }),
      ).resolves.toEqual({ success: true, deleted: true });

      expect(mockRunGcpDbInit).toHaveBeenCalledWith({
        mode: 'remove',
        terraformDir: '/p/infrastructure/terraform/dev',
        tfEnv: { GOOGLE_PROJECT: 'gcp-shop' },
        projectName: 'shop',
        targetEnv: 'dev',
        credentials: ctx.credentials,
        serviceNames: ['auth-service'],
      });
    });
  });

  describe('Edge cases', () => {
    it('should skip an environment without db-init (deployed by an older CLI)', async () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Output not found');
      });

      await expect(
        dropDatabaseRoles({ ctx, serviceName: 'auth-service' }),
      ).resolves.toEqual({
        success: true,
        deleted: false,
        error: 'Skipped: no db-init in this environment yet (no app role)',
      });
      expect(mockRunGcpDbInit).not.toHaveBeenCalled();
    });

    it('should report a failed run', async () => {
      mockRunGcpDbInit.mockRejectedValue(new Error('db-init (remove) failed'));

      await expect(
        dropDatabaseRoles({ ctx, serviceName: 'auth-service' }),
      ).resolves.toEqual({
        success: false,
        deleted: false,
        error: 'db-init (remove) failed',
      });
    });
  });
});
