import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockExecSync, mockConfigureAcrAuth } = rs.hoisted(() => ({
  mockExecSync: rs.fn(),
  mockConfigureAcrAuth: rs.fn(),
}));

rs.mock('node:child_process', () => ({ execSync: mockExecSync }));
rs.mock('@tsdevstack/infra-core', () => ({
  configureAcrAuth: mockConfigureAcrAuth,
}));
rs.mock('../build-runtime', () => ({ buildRuntime: () => ({}) }));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { buildAndPushAzureDbInit } from './build-and-push-azure-db-init';

const credentials = {
  subscriptionId: 's',
  tenantId: 't',
  clientId: 'c',
  clientSecret: 'x',
  location: 'swedencentral',
};

describe('buildAndPushAzureDbInit', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should log in to the registry, build for Container Apps and push', async () => {
      const image = await buildAndPushAzureDbInit({
        dbInitDir: '/p/infrastructure/terraform/dev/db-init',
        acrLoginServer: 'shopdevacr.azurecr.io',
        credentials,
      });

      expect(image).toBe('shopdevacr.azurecr.io/db-init:latest');
      expect(mockConfigureAcrAuth).toHaveBeenCalledWith(
        {},
        credentials,
        'shopdevacr.azurecr.io',
      );
      expect(mockExecSync.mock.calls).toEqual([
        [
          'docker build --platform linux/amd64 -t shopdevacr.azurecr.io/db-init:latest .',
          { cwd: '/p/infrastructure/terraform/dev/db-init', stdio: 'inherit' },
        ],
        [
          'docker push shopdevacr.azurecr.io/db-init:latest',
          { stdio: 'inherit' },
        ],
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should not push when the build fails', async () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('build failed');
      });

      await expect(
        buildAndPushAzureDbInit({
          dbInitDir: '/d',
          acrLoginServer: 'r.azurecr.io',
          credentials,
        }),
      ).rejects.toThrow('build failed');
      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });
  });
});
