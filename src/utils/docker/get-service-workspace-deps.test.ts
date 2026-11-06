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

  describe('when workspace packages depend on other workspace packages', () => {
    const packageJsons: Record<string, object> = {
      'apps/bff-service/package.json': {
        dependencies: {
          '@shared/auth-service-client': '*',
          '@tsdevstack/nest-common': '^0.10.0',
        },
      },
      'packages/auth-service-client/package.json': {
        name: '@shared/auth-service-client',
      },
      'packages/nest-common/package.json': {
        name: '@tsdevstack/nest-common',
        dependencies: { '@tsdevstack/telemetry': '^0.0.0', pino: '^10.0.0' },
      },
      'packages/telemetry/package.json': {
        name: '@tsdevstack/telemetry',
        dependencies: { '@opentelemetry/api': '^1.10.0' },
      },
    };

    beforeEach(() => {
      rs.mocked(fs.existsSync).mockReturnValue(true);
      rs.mocked(fs.readdirSync).mockReturnValue(
        createMockDirents(
          { name: 'auth-service-client', isDir: true },
          { name: 'nest-common', isDir: true },
          { name: 'telemetry', isDir: true },
        ),
      );
    });

    it('should include the packages they need, before them', () => {
      rs.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
        const key = Object.keys(packageJsons).find((k) =>
          String(p).endsWith(k),
        );
        return JSON.stringify(key ? packageJsons[key] : {});
      });

      const result = getServiceWorkspaceDeps('/project', 'bff-service');

      expect(result).toEqual([
        'packages/auth-service-client',
        'packages/telemetry',
        'packages/nest-common',
      ]);
    });

    it('should list a package needed twice once', () => {
      const withShared: Record<string, object> = {
        ...packageJsons,
        'packages/auth-service-client/package.json': {
          name: '@shared/auth-service-client',
          dependencies: { '@tsdevstack/telemetry': '^0.0.0' },
        },
      };
      rs.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
        const key = Object.keys(withShared).find((k) => String(p).endsWith(k));
        return JSON.stringify(key ? withShared[key] : {});
      });

      const result = getServiceWorkspaceDeps('/project', 'bff-service');

      expect(result).toEqual([
        'packages/telemetry',
        'packages/auth-service-client',
        'packages/nest-common',
      ]);
    });

    it('should stop on packages that need each other', () => {
      const cyclic: Record<string, object> = {
        ...packageJsons,
        'packages/telemetry/package.json': {
          name: '@tsdevstack/telemetry',
          devDependencies: { '@tsdevstack/nest-common': '*' },
        },
      };
      rs.mocked(fs.readFileSync).mockImplementation((p: unknown) => {
        const key = Object.keys(cyclic).find((k) => String(p).endsWith(k));
        return JSON.stringify(key ? cyclic[key] : {});
      });

      const result = getServiceWorkspaceDeps('/project', 'bff-service');

      expect(result).toEqual([
        'packages/auth-service-client',
        'packages/telemetry',
        'packages/nest-common',
      ]);
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
