import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockFs = {
  existsSync: rs.fn(),
  readFileSync: rs.fn(),
};
rs.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockFs.existsSync(...args),
  readFileSync: (...args: unknown[]) => mockFs.readFileSync(...args),
}));

import { loadInfrastructureConfig } from './load-infrastructure-config';

describe('loadInfrastructureConfig', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mocks.findProjectRoot.mockReturnValue('/test/project');
    mocks.TSDEVSTACK_DIR = '.tsdevstack';
  });

  describe('when config file does not exist', () => {
    it('should return null', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = loadInfrastructureConfig();

      expect(result).toBeNull();
    });

    it('should check correct path', () => {
      mockFs.existsSync.mockReturnValue(false);

      loadInfrastructureConfig();

      expect(mockFs.existsSync).toHaveBeenCalledWith(
        '/test/project/.tsdevstack/infrastructure.json',
      );
    });
  });

  describe('when config file exists', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
    });

    it('should parse and return valid JSON config', () => {
      const config = {
        version: '1.0.0',
        dev: { 'auth-service': { minInstances: 1 } },
      };
      mockFs.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = loadInfrastructureConfig();

      expect(result).toEqual(config);
    });

    it('should throw CliError for empty file', () => {
      mockFs.readFileSync.mockReturnValue('');

      expect(() => loadInfrastructureConfig()).toThrow(mocks.CliError);
    });

    it('should throw CliError for whitespace-only file', () => {
      mockFs.readFileSync.mockReturnValue('   \n  \t  ');

      expect(() => loadInfrastructureConfig()).toThrow(mocks.CliError);
    });

    it('should throw CliError for invalid JSON', () => {
      mockFs.readFileSync.mockReturnValue('{ invalid json }');

      expect(() => loadInfrastructureConfig()).toThrow(mocks.CliError);
    });

    it('should throw CliError when file read fails', () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() => loadInfrastructureConfig()).toThrow(mocks.CliError);
    });
  });

  describe('error messages', () => {
    beforeEach(() => {
      mockFs.existsSync.mockReturnValue(true);
    });

    it('should include filename in empty file error', () => {
      mockFs.readFileSync.mockReturnValue('');

      try {
        loadInfrastructureConfig();
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('infrastructure.json');
        expect((error as Error).message).toContain('empty');
      }
    });

    it('should include filename in invalid JSON error', () => {
      mockFs.readFileSync.mockReturnValue('not json');

      try {
        loadInfrastructureConfig();
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Invalid JSON');
      }
    });
  });
});
