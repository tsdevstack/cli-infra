import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateVersion } from './validate-version';
import type { InfrastructureConfig } from './types';

describe('validateVersion', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('valid versions', () => {
    it('should accept version 1.0.0', () => {
      const config = { version: '1.0.0' } as InfrastructureConfig;
      expect(() => validateVersion(config)).not.toThrow();
    });
  });

  describe('missing version', () => {
    it('should throw if version field is missing', () => {
      const config = {} as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should include helpful hint in missing version error', () => {
      const config = {} as InfrastructureConfig;
      try {
        validateVersion(config);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Missing');
        expect((error as Error).message).toContain('version');
      }
    });
  });

  describe('invalid type', () => {
    it('should throw for number', () => {
      const config = { version: 1 } as unknown as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for null', () => {
      const config = { version: null } as unknown as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for object', () => {
      const config = { version: {} } as unknown as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for array', () => {
      const config = { version: ['1.0.0'] } as unknown as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });
  });

  describe('invalid format', () => {
    it('should throw for version without minor', () => {
      const config = { version: '1' } as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for version without patch', () => {
      const config = { version: '1.0' } as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for version with v prefix', () => {
      const config = { version: 'v1.0.0' } as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for version with prerelease suffix', () => {
      const config = { version: '1.0.0-beta' } as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for empty string', () => {
      const config = { version: '' } as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for non-numeric version parts', () => {
      const config = { version: 'a.b.c' } as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });
  });

  describe('unsupported versions', () => {
    it('should throw for version 2.0.0', () => {
      const config = { version: '2.0.0' } as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should throw for version 0.9.0', () => {
      const config = { version: '0.9.0' } as InfrastructureConfig;
      expect(() => validateVersion(config)).toThrow(mocks.CliError);
    });

    it('should include supported versions in error message', () => {
      const config = { version: '2.0.0' } as InfrastructureConfig;
      try {
        validateVersion(config);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('Unsupported');
        expect((error as Error).message).toContain('2.0.0');
      }
    });
  });
});
