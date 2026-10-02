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

import { validateDatabaseServerName } from './validate-database-server-name';

function captureError(fn: () => void): { message: string; hint?: string } {
  try {
    fn();
  } catch (error) {
    return error as { message: string; hint?: string };
  }
  throw new Error('Expected function to throw');
}

describe('validateDatabaseServerName', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should accept a valid name on azure', () => {
      expect(() =>
        validateDatabaseServerName('dev', 'myapp-dev-postgres-2', 'azure'),
      ).not.toThrow();
    });

    it('should do nothing when serverName is not set (azure)', () => {
      expect(() =>
        validateDatabaseServerName('dev', undefined, 'azure'),
      ).not.toThrow();
    });

    it('should do nothing when serverName is not set (gcp)', () => {
      expect(() =>
        validateDatabaseServerName('dev', undefined, 'gcp'),
      ).not.toThrow();
    });

    it('should do nothing when serverName is not set (aws)', () => {
      expect(() =>
        validateDatabaseServerName('dev', undefined, 'aws'),
      ).not.toThrow();
    });
  });

  describe('Provider check', () => {
    it('should reject serverName on gcp', () => {
      expect(() =>
        validateDatabaseServerName('dev', 'myapp-dev-postgres', 'gcp'),
      ).toThrow(mocks.CliError);
    });

    it('should reject serverName on aws', () => {
      expect(() =>
        validateDatabaseServerName('prod', 'myapp-prod-postgres', 'aws'),
      ).toThrow(mocks.CliError);
    });

    it('should name the provider and field, and hint to remove it', () => {
      const error = captureError(() =>
        validateDatabaseServerName('prod', 'myapp-prod-postgres', 'aws'),
      );
      expect(error.message).toContain('not supported on AWS');
      expect(error.message).toContain('prod.database.serverName');
      expect(error.hint).toContain('Azure only');
      expect(error.hint).toContain('Remove "serverName" from prod.database');
    });

    it('should reject on gcp even when the name is invalid for azure', () => {
      const error = captureError(() =>
        validateDatabaseServerName('dev', 'X', 'gcp'),
      );
      expect(error.message).toContain('not supported on GCP');
    });
  });

  describe('Azure naming rules', () => {
    it('should reject a non-string value', () => {
      const error = captureError(() =>
        validateDatabaseServerName('dev', 42, 'azure'),
      );
      expect(error.message).toContain('must be a string');
      expect(error.message).toContain('dev.database.serverName');
    });

    it('should reject an empty string', () => {
      expect(() => validateDatabaseServerName('dev', '', 'azure')).toThrow(
        mocks.CliError,
      );
    });

    it('should reject a name shorter than 3 characters', () => {
      const error = captureError(() =>
        validateDatabaseServerName('dev', 'ab', 'azure'),
      );
      expect(error.message).toContain('3 to 63 characters');
      expect(error.message).toContain('got 2');
    });

    it('should accept a name of exactly 3 characters', () => {
      expect(() =>
        validateDatabaseServerName('dev', 'abc', 'azure'),
      ).not.toThrow();
    });

    it('should accept a name of exactly 63 characters', () => {
      expect(() =>
        validateDatabaseServerName('dev', 'a'.repeat(63), 'azure'),
      ).not.toThrow();
    });

    it('should reject a name longer than 63 characters', () => {
      const error = captureError(() =>
        validateDatabaseServerName('dev', 'a'.repeat(64), 'azure'),
      );
      expect(error.message).toContain('3 to 63 characters');
      expect(error.message).toContain('got 64');
    });

    it('should reject uppercase letters', () => {
      const error = captureError(() =>
        validateDatabaseServerName('dev', 'MyApp-dev-postgres', 'azure'),
      );
      expect(error.message).toContain(
        'is not a valid Azure PostgreSQL server name',
      );
      expect(error.hint).toContain('lowercase letters, digits and hyphens');
    });

    it('should reject underscores', () => {
      expect(() =>
        validateDatabaseServerName('dev', 'myapp_dev_postgres', 'azure'),
      ).toThrow(mocks.CliError);
    });

    it('should reject dots', () => {
      expect(() =>
        validateDatabaseServerName('dev', 'myapp.dev.postgres', 'azure'),
      ).toThrow(mocks.CliError);
    });

    it('should reject a leading hyphen', () => {
      expect(() =>
        validateDatabaseServerName('dev', '-myapp-postgres', 'azure'),
      ).toThrow(mocks.CliError);
    });

    it('should reject a trailing hyphen', () => {
      expect(() =>
        validateDatabaseServerName('dev', 'myapp-postgres-', 'azure'),
      ).toThrow(mocks.CliError);
    });

    it('should accept digits at the start and end', () => {
      expect(() =>
        validateDatabaseServerName('dev', '1myapp-postgres2', 'azure'),
      ).not.toThrow();
    });
  });
});
