import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import fs from 'node:fs';

const { mockExecSync } = rs.hoisted(() => ({ mockExecSync: rs.fn() }));

rs.mock('node:child_process', () => ({ execSync: mockExecSync }));

import { buildKongCollectorImage } from './build-kong-collector-image';

describe('buildKongCollectorImage', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should build the image with the config and tag it latest', () => {
      let written: { dockerfile: string; config: string } | undefined;
      mockExecSync.mockImplementation(
        (command: string, options?: { cwd?: string }) => {
          if (command.startsWith('docker build') && options?.cwd) {
            written = {
              dockerfile: fs.readFileSync(`${options.cwd}/Dockerfile`, 'utf-8'),
              config: fs.readFileSync(`${options.cwd}/config.yaml`, 'utf-8'),
            };
          }
          return Buffer.from('');
        },
      );

      const tags = buildKongCollectorImage({
        registryUrl: 'us-docker.pkg.dev/p/repo',
        imageTag: 'abc123',
        config: { exporters: { otlp_http: {} } },
      });

      expect(tags).toEqual({
        fullImageTag: 'us-docker.pkg.dev/p/repo/kong-collector:abc123',
        latestTag: 'us-docker.pkg.dev/p/repo/kong-collector:latest',
      });
      expect(mockExecSync).toHaveBeenCalledWith(
        'docker build --platform linux/amd64 -t us-docker.pkg.dev/p/repo/kong-collector:abc123 .',
        expect.objectContaining({ stdio: 'inherit' }),
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        'docker tag us-docker.pkg.dev/p/repo/kong-collector:abc123 us-docker.pkg.dev/p/repo/kong-collector:latest',
        { stdio: 'pipe' },
      );
      expect(written?.dockerfile).toContain('COPY config.yaml');
      expect(written?.config).toContain('otlp_http: {}');
    });
  });

  describe('Edge cases', () => {
    it('should remove the build context even when the build fails', () => {
      let contextDir: string | undefined;
      mockExecSync.mockImplementation(
        (_command: string, options?: { cwd?: string }) => {
          contextDir = options?.cwd;
          throw new Error('build failed');
        },
      );

      expect(() =>
        buildKongCollectorImage({
          registryUrl: 'r',
          imageTag: 't',
          config: {},
        }),
      ).toThrow('build failed');
      expect(contextDir && fs.existsSync(contextDir)).toBe(false);
    });
  });
});
