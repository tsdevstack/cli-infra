import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockGetTerraformOutput } = rs.hoisted(() => ({
  mockGetTerraformOutput: rs.fn(),
}));

rs.mock('../terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('@tsdevstack/infra-core', () => ({ buildGcpTerraformEnv: () => ({}) }));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

import { getGcpDbExportsBucket } from './get-gcp-db-exports-bucket';
import type { GCPCommandContext } from '../commands/types';

const ctx = {
  projectRoot: '/p',
  targetEnv: 'dev',
  credentials: {},
} as unknown as GCPCommandContext;

describe('getGcpDbExportsBucket', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should read the bucket from the environment's Terraform output", () => {
      mockGetTerraformOutput.mockReturnValue('shop-db-exports-gcp-shop');

      expect(getGcpDbExportsBucket(ctx)).toBe('shop-db-exports-gcp-shop');
      expect(mockGetTerraformOutput).toHaveBeenCalledWith(
        '/p/infrastructure/terraform/dev',
        'db_exports_bucket',
        {},
      );
    });
  });

  describe('Edge cases', () => {
    it('should give null for an environment deployed before the bucket', () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Output "db_exports_bucket" not found');
      });

      expect(getGcpDbExportsBucket(ctx)).toBeNull();
    });
  });
});
