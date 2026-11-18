import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockRunGcpDbInit } = rs.hoisted(() => ({ mockRunGcpDbInit: rs.fn() }));

rs.mock('../run-gcp-db-init', () => ({ runGcpDbInit: mockRunGcpDbInit }));
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: () => ({ GOOGLE_CREDENTIALS: 'x' }),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

import { runGcpDatabaseJob } from './run-gcp-database-job';
import type { GCPCommandContext } from '../commands/types';

const ctx = {
  projectName: 'shop',
  projectRoot: '/p',
  targetEnv: 'dev',
  credentials: {
    project_id: 'gcp-shop',
    region: 'europe-west1',
    client_email: 'x@gcp-shop.iam.gserviceaccount.com',
    private_key: 'k',
  },
} as unknown as GCPCommandContext;

describe('runGcpDatabaseJob', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockRunGcpDbInit.mockResolvedValue(undefined);
  });

  describe('Standard use cases', () => {
    it("should run db-init's mode for the one service and its file", async () => {
      await runGcpDatabaseJob({
        ctx,
        mode: 'export',
        serviceName: 'auth-service',
        file: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
      });

      expect(mockRunGcpDbInit).toHaveBeenCalledWith({
        mode: 'export',
        exportFile: 'auth-service/2026-11-14T12-30-00Z-removed.dump',
        terraformDir: '/p/infrastructure/terraform/dev',
        tfEnv: { GOOGLE_CREDENTIALS: 'x' },
        projectName: 'shop',
        targetEnv: 'dev',
        credentials: ctx.credentials,
        serviceNames: ['auth-service'],
      });
    });
  });

  describe('Edge cases', () => {
    it("should pass on the job's failure", async () => {
      mockRunGcpDbInit.mockRejectedValue(new Error('db-init (restore) failed'));

      await expect(
        runGcpDatabaseJob({
          ctx,
          mode: 'restore',
          serviceName: 'auth-service',
          file: 'f',
        }),
      ).rejects.toThrow('db-init (restore) failed');
    });
  });
});
