import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockGetTerraformOutput } = rs.hoisted(() => ({
  mockGetTerraformOutput: rs.fn(),
}));

rs.mock('../terraform', () => ({ getTerraformOutput: mockGetTerraformOutput }));
rs.mock('@tsdevstack/infra-core', () => ({
  buildAzureTerraformEnv: () => ({}),
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

import { getAzureDbExports } from './get-azure-db-exports';
import type { AzureCommandContext } from '../commands/types';

const ctx = {
  projectRoot: '/p',
  targetEnv: 'dev',
  credentials: {},
} as unknown as AzureCommandContext;

const outputs: Record<string, string> = {
  db_exports_storage_account: 'shopdevdbx12b937',
  db_exports_container_url:
    'https://shopdevdbx12b937.blob.core.windows.net/db-exports',
};

describe('getAzureDbExports', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should read the account and the container from the environment's Terraform outputs", () => {
      mockGetTerraformOutput.mockImplementation(
        (_dir: string, name: string) => outputs[name],
      );

      expect(getAzureDbExports(ctx)).toEqual({
        storageAccount: 'shopdevdbx12b937',
        containerUrl:
          'https://shopdevdbx12b937.blob.core.windows.net/db-exports',
      });
      expect(mockGetTerraformOutput).toHaveBeenCalledWith(
        '/p/infrastructure/terraform/dev',
        'db_exports_storage_account',
        {},
      );
    });
  });

  describe('Edge cases', () => {
    it('should give null for an environment deployed before the storage', () => {
      mockGetTerraformOutput.mockImplementation(() => {
        throw new Error('Output "db_exports_storage_account" not found');
      });

      expect(getAzureDbExports(ctx)).toBeNull();
    });
  });
});
