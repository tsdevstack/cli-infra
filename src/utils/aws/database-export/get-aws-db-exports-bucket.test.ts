import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockGetTerraformOutput } = rs.hoisted(() => ({
  mockGetTerraformOutput: rs.fn(),
}));

rs.mock('../terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('@tsdevstack/infra-core', () => ({ buildAwsTerraformEnv: () => ({}) }));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

import { getAwsDbExportsBucket } from './get-aws-db-exports-bucket';
import type { AWSCommandContext } from '../commands/types';

const ctx = {
  projectRoot: '/p',
  targetEnv: 'dev',
  credentials: {},
} as unknown as AWSCommandContext;

describe('getAwsDbExportsBucket', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should read the bucket from the environment's Terraform output", () => {
      mockGetTerraformOutput.mockReturnValue('shop-db-exports-123456789012');

      expect(getAwsDbExportsBucket(ctx)).toBe('shop-db-exports-123456789012');
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

      expect(getAwsDbExportsBucket(ctx)).toBeNull();
    });
  });
});
