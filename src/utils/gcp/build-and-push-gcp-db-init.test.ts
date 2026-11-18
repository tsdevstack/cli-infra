import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockExecSync, mockConfigureDockerAuth } = rs.hoisted(() => ({
  mockExecSync: rs.fn(),
  mockConfigureDockerAuth: rs.fn(),
}));

rs.mock('node:child_process', () => ({ execSync: mockExecSync }));
rs.mock('@tsdevstack/infra-core', () => ({
  configureDockerAuth: mockConfigureDockerAuth,
}));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { buildAndPushGcpDbInit } from './build-and-push-gcp-db-init';

const credentials = {
  project_id: 'gcp-shop',
  region: 'europe-west1',
  client_email: 'x@gcp-shop.iam.gserviceaccount.com',
  private_key: 'k',
};

describe('buildAndPushGcpDbInit', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should log in to the registry, build for Cloud Run and push', async () => {
      const imageUri =
        'europe-west1-docker.pkg.dev/gcp-shop/shop/db-init:latest';

      await buildAndPushGcpDbInit({
        dbInitDir: '/p/infrastructure/terraform/dev/db-init',
        imageUri,
        credentials,
      });

      expect(mockConfigureDockerAuth).toHaveBeenCalledWith(
        credentials,
        'europe-west1-docker.pkg.dev',
      );
      expect(mockExecSync.mock.calls).toEqual([
        [
          `docker build --platform linux/amd64 -t ${imageUri} .`,
          { cwd: '/p/infrastructure/terraform/dev/db-init', stdio: 'inherit' },
        ],
        [`docker push ${imageUri}`, { stdio: 'inherit' }],
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should not push when the build fails', async () => {
      mockExecSync.mockImplementationOnce(() => {
        throw new Error('build failed');
      });

      await expect(
        buildAndPushGcpDbInit({
          dbInitDir: '/d',
          imageUri: 'r.example/p/r/db-init:latest',
          credentials,
        }),
      ).rejects.toThrow('build failed');
      expect(mockExecSync).toHaveBeenCalledTimes(1);
    });
  });
});
