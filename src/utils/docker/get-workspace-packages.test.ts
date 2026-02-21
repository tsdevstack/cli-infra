import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import fs from 'node:fs';
import { getWorkspacePackages } from './get-workspace-packages';

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

describe('getWorkspacePackages', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('when packages directory exists', () => {
    it('should return package paths for directories with package.json', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.endsWith('packages')) return true;
        if (path.includes('package.json')) return true;
        return false;
      });

      rs.mocked(fs.readdirSync).mockReturnValue(
        createMockDirents(
          { name: 'nest-common', isDir: true },
          { name: 'auth-client', isDir: true },
        ),
      );

      const result = getWorkspacePackages('/project');

      expect(result).toEqual(['packages/auth-client', 'packages/nest-common']);
    });

    it('should skip directories without package.json', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.endsWith('packages')) return true;
        if (path.includes('nest-common/package.json')) return true;
        if (path.includes('no-package/package.json')) return false;
        return false;
      });

      rs.mocked(fs.readdirSync).mockReturnValue(
        createMockDirents(
          { name: 'nest-common', isDir: true },
          { name: 'no-package', isDir: true },
        ),
      );

      const result = getWorkspacePackages('/project');

      expect(result).toEqual(['packages/nest-common']);
    });

    it('should skip files (non-directories)', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.endsWith('packages')) return true;
        if (path.includes('package.json')) return true;
        return false;
      });

      rs.mocked(fs.readdirSync).mockReturnValue(
        createMockDirents(
          { name: 'nest-common', isDir: true },
          { name: 'README.md', isDir: false },
        ),
      );

      const result = getWorkspacePackages('/project');

      expect(result).toEqual(['packages/nest-common']);
    });

    it('should return sorted results', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        const path = String(p);
        if (path.endsWith('packages')) return true;
        if (path.includes('package.json')) return true;
        return false;
      });

      rs.mocked(fs.readdirSync).mockReturnValue(
        createMockDirents(
          { name: 'zebra-utils', isDir: true },
          { name: 'alpha-common', isDir: true },
          { name: 'beta-client', isDir: true },
        ),
      );

      const result = getWorkspacePackages('/project');

      expect(result).toEqual([
        'packages/alpha-common',
        'packages/beta-client',
        'packages/zebra-utils',
      ]);
    });
  });

  describe('when packages directory does not exist', () => {
    it('should return empty array', () => {
      rs.mocked(fs.existsSync).mockReturnValue(false);

      const result = getWorkspacePackages('/project');

      expect(result).toEqual([]);
    });
  });

  describe('when packages directory is empty', () => {
    it('should return empty array', () => {
      rs.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).endsWith('packages');
      });

      rs.mocked(fs.readdirSync).mockReturnValue([]);

      const result = getWorkspacePackages('/project');

      expect(result).toEqual([]);
    });
  });
});
