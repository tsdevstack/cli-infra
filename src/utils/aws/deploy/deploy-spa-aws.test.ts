import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../build-runtime', () => ({ buildRuntime: () => ({}) }));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(),
}));

rs.mock('node:child_process', () => ({
  execSync: rs.fn(),
}));

rs.mock('../../deploy/fetch-service-secrets', () => ({
  fetchServiceSecrets: rs.fn(),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: rs.fn(() => ({ AWS_REGION: 'eu-central-1' })),
  uploadSpaToS3: rs.fn(),
  invalidateCloudfront: rs.fn(),
}));

rs.mock('node:fs', () => ({
  default: {
    existsSync: rs.fn(),
  },
}));

import { deploySpaAws } from './deploy-spa-aws';
import { getTerraformOutput } from '../terraform';
import { execSync } from 'node:child_process';
import { fetchServiceSecrets } from '../../deploy/fetch-service-secrets';
import { uploadSpaToS3, invalidateCloudfront } from '@tsdevstack/infra-core';
import fs from 'node:fs';

const OPTIONS = {
  projectRoot: '/test/project',
  targetEnv: 'dev',
  credentials: {
    region: 'eu-central-1',
    accessKeyId: 'key-id',
    secretAccessKey: 'secret',
    accountId: '123456789012',
  },
  service: { name: 'react-app', type: 'spa' },
};

const OUTPUTS: Record<string, string> = {
  react_app_spa_bucket: 'shop-react-app-spa-123456789012',
  react_app_cloudfront_id: 'E1ABCDEF',
};

/** Paths that exist; everything else doesn't */
function existing(...paths: string[]): void {
  rs.mocked(fs.existsSync).mockImplementation((p) => paths.includes(String(p)));
}

describe('deploySpaAws', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    existing(
      '/test/project/infrastructure/terraform/dev',
      '/test/project/apps/react-app/dist',
    );
    rs.mocked(getTerraformOutput).mockImplementation(
      (_dir: string, key: string) => {
        if (!(key in OUTPUTS)) throw new Error(`No output ${key}`);
        return OUTPUTS[key];
      },
    );
    mocks.loadFrameworkConfig.mockReturnValue({ services: [] });
    rs.mocked(fetchServiceSecrets).mockReturnValue({
      VITE_API_URL: 'https://api.example.com',
    });
    rs.mocked(execSync).mockReturnValue(Buffer.from(''));
    rs.mocked(uploadSpaToS3).mockResolvedValue({
      filesUploaded: 12,
      filesDeleted: 0,
      filesKept: 0,
    });
    rs.mocked(invalidateCloudfront).mockResolvedValue({
      invalidationId: 'I2J0I21PCUYOIK',
    });
  });

  describe('Standard use cases', () => {
    it('should build with the secrets, upload to the bucket, then clear the distribution', async () => {
      await deploySpaAws(OPTIONS);

      expect(execSync).toHaveBeenCalledWith(
        'npm run build -w react-app',
        expect.objectContaining({
          cwd: '/test/project',
          env: expect.objectContaining({
            VITE_API_URL: 'https://api.example.com',
            NODE_ENV: 'production',
          }),
        }),
      );
      expect(uploadSpaToS3).toHaveBeenCalledWith(
        {},
        {
          bucketName: 'shop-react-app-spa-123456789012',
          sourceDir: '/test/project/apps/react-app/dist',
          credentials: OPTIONS.credentials,
        },
      );
      expect(invalidateCloudfront).toHaveBeenCalledWith(
        {},
        { distributionId: 'E1ABCDEF', credentials: OPTIONS.credentials },
      );
      expect(rs.mocked(uploadSpaToS3).mock.invocationCallOrder[0]).toBeLessThan(
        rs.mocked(invalidateCloudfront).mock.invocationCallOrder[0],
      );
      expect(mocks.logger.complete).toHaveBeenCalledWith(
        'SPA react-app deployed successfully!',
      );
    });

    it('should upload build/ when there is no dist/', async () => {
      existing(
        '/test/project/infrastructure/terraform/dev',
        '/test/project/apps/react-app/build',
      );

      await deploySpaAws(OPTIONS);

      expect(rs.mocked(uploadSpaToS3).mock.calls[0][1].sourceDir).toBe(
        '/test/project/apps/react-app/build',
      );
    });

    it('should say how many old files were deleted and kept', async () => {
      rs.mocked(uploadSpaToS3).mockResolvedValue({
        filesUploaded: 12,
        filesDeleted: 3,
        filesKept: 2,
      });

      await deploySpaAws(OPTIONS);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        '  ✓ 3 stale files deleted',
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('2 files from earlier builds kept'),
      );
    });
  });

  describe('Edge cases', () => {
    it('should stop when the environment has no Terraform folder', async () => {
      existing();

      await expect(deploySpaAws(OPTIONS)).rejects.toThrow(
        'Terraform directory not found',
      );
      expect(execSync).not.toHaveBeenCalled();
    });

    it('should stop when the SPA has no bucket yet', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(() => {
        throw new Error('No output');
      });

      await expect(deploySpaAws(OPTIONS)).rejects.toThrow(
        'SPA infrastructure not found for service "react-app"',
      );
    });

    it('should stop when the SPA has no distribution yet', async () => {
      rs.mocked(getTerraformOutput).mockImplementation(
        (_dir: string, key: string) => {
          if (key === 'react_app_spa_bucket') return 'bucket';
          throw new Error('No output');
        },
      );

      await expect(deploySpaAws(OPTIONS)).rejects.toThrow(
        'CloudFront distribution not found for service "react-app"',
      );
    });

    it('should stop when the build fails, before uploading', async () => {
      rs.mocked(execSync).mockImplementation(() => {
        throw new Error('exit 1');
      });

      await expect(deploySpaAws(OPTIONS)).rejects.toThrow(
        'Failed to build react-app',
      );
      expect(uploadSpaToS3).not.toHaveBeenCalled();
    });

    it('should stop when the build left no dist/ or build/', async () => {
      existing('/test/project/infrastructure/terraform/dev');

      await expect(deploySpaAws(OPTIONS)).rejects.toThrow(
        'Build output not found for react-app',
      );
      expect(uploadSpaToS3).not.toHaveBeenCalled();
    });

    it('should finish with a warning when clearing the cache fails', async () => {
      rs.mocked(invalidateCloudfront).mockRejectedValue(
        new Error('Throttling'),
      );

      await deploySpaAws(OPTIONS);

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        '  ⚠ Invalidation failed: Throttling',
      );
      expect(mocks.logger.complete).toHaveBeenCalled();
    });
  });
});
