import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import fs from 'node:fs';
import { getServiceWorkspaceDeps } from './get-service-workspace-deps';

rs.mock('node:fs', { mock: true });

// Helper to create mock Dirent entries - uses 'never' cast to bypass strict generic typing
function createMockDirents(
  ...entries: Array<{ name: string; isDir: boolean }>
): never {
  return entries.map(({ name, isDir }) => ({
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    path: '',
    parentPath: '',
  })) as never;
}

describe('getServiceWorkspaceDeps', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('when service depends on workspace packages', () => {
    it('should return only the packages the service depends on', () => {
      rs.mocked(fs.existsSync).mockImplementation((p: unknown) => {
        const pathStr = String(p);
        if (pathStr.includes('apps/auth-service/package.json')) return true;
        if (pathStr.includes('packages')) return true;
        return false;
      });

      rs.mocked(fs.readdirSync).mockReturnValue(
        createMockDirents(
          { name: 'nest-common', isDir: true },
          { name: 'cli-core', isDir: true },
          { name: 'auth-service-client', isDir: true },
        ),
      );

      rs.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
        const pathStr = String(p);
        if (pathStr.includes('apps/auth-service/package.json')) {
          return JSON.stringify({
            dependencies: {
              '@tsdevstack/nest-common': '*',
              '@nestjs/core': '^11.0.0',
            },
          });
        }
        if (pathStr.includes('packages/nest-common/package.json')) {
          return JSON.stringify({ name: '@tsdevstack/nest-common' });
        }
        if (pathStr.includes('packages/cli-core/package.json')) {
          return JSON.stringify({ name: 'tsdevstack' });
        }
        if (pathStr.includes('packages/auth-service-client/package.json')) {
          return JSON.stringify({ name: '@tsdevstack/auth-service-client' });
        }
        return '{}';
      });

      const result = getServiceWorkspaceDeps('/project', 'auth-service');

      expect(result).toEqual(['packages/nest-common']);
    });

    it('should include dev dependencies for build', () => {
      rs.mocked(fs.existsSync).mockReturnValue(true);

      rs.mocked(fs.readdirSync).mockReturnValue(
        createMockDirents(
          { name: 'nest-common', isDir: true },
          { name: 'test-utils', isDir: true },
        ),
      );

      rs.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
        const pathStr = String(p);
        if (pathStr.includes('apps/my-service/package.json')) {
          return JSON.stringify({
            dependencies: {
              '@tsdevstack/nest-common': '*',
            },
            devDependencies: {
              '@tsdevstack/test-utils': '*',
            },
          });
        }
        if (pathStr.includes('packages/nest-common/package.json')) {
          return JSON.stringify({ name: '@tsdevstack/nest-common' });
        }
        if (pathStr.includes('packages/test-utils/package.json')) {
          return JSON.stringify({ name: '@tsdevstack/test-utils' });
        }
        return '{}';
      });

      const result = getServiceWorkspaceDeps('/project', 'my-service');

      expect(result).toEqual(['packages/nest-common', 'packages/test-utils']);
    });
  });

  describe('when service has no workspace dependencies', () => {
    it('should return empty array', () => {
      rs.mocked(fs.existsSync).mockReturnValue(true);

      rs.mocked(fs.readdirSync).mockReturnValue(
        createMockDirents({ name: 'cli-core', isDir: true }),
      );

      rs.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
        const pathStr = String(p);
        if (pathStr.includes('apps/standalone/package.json')) {
          return JSON.stringify({
            dependencies: {
              express: '^4.0.0',
            },
          });
        }
        if (pathStr.includes('packages/cli-core/package.json')) {
          return JSON.stringify({ name: 'tsdevstack' });
        }
        return '{}';
      });

      const result = getServiceWorkspaceDeps('/project', 'standalone');

      expect(result).toEqual([]);
    });
  });

  describe('when service package.json does not exist', () => {
    it('should return empty array', () => {
      rs.mocked(fs.existsSync).mockReturnValue(false);

      const result = getServiceWorkspaceDeps('/project', 'nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('when packages directory does not exist', () => {
    it('should return empty array', () => {
      rs.mocked(fs.existsSync).mockImplementation((p: unknown) => {
        const pathStr = String(p);
        if (pathStr.includes('apps/my-service/package.json')) return true;
        return false;
      });

      rs.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ dependencies: {} }),
      );

      const result = getServiceWorkspaceDeps('/project', 'my-service');

      expect(result).toEqual([]);
    });
  });
});
