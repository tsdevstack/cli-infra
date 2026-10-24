import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateDatabaseDiskSize } from './validate-database-disk-size';
import {
  DATABASE_DEFAULTS_GCP,
  DATABASE_DEFAULTS_AWS,
  DATABASE_DEFAULTS_AZURE,
} from '../../constants';

function captureError(fn: () => void): { message: string; hint?: string } {
  try {
    fn();
  } catch (error) {
    return error as { message: string; hint?: string };
  }
  throw new Error('Expected function to throw');
}

describe('validateDatabaseDiskSize', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should do nothing when diskSize is not set', () => {
      expect(() =>
        validateDatabaseDiskSize('dev', undefined, 'aws'),
      ).not.toThrow();
    });

    it('should accept each provider default', () => {
      expect(() =>
        validateDatabaseDiskSize('dev', DATABASE_DEFAULTS_GCP.diskSize, 'gcp'),
      ).not.toThrow();
      expect(() =>
        validateDatabaseDiskSize('dev', DATABASE_DEFAULTS_AWS.diskSize, 'aws'),
      ).not.toThrow();
      expect(() =>
        validateDatabaseDiskSize(
          'dev',
          DATABASE_DEFAULTS_AZURE.diskSize,
          'azure',
        ),
      ).not.toThrow();
    });

    it('should accept 10 GB on GCP', () => {
      expect(() => validateDatabaseDiskSize('dev', 10, 'gcp')).not.toThrow();
    });

    it('should accept 50 GB on AWS', () => {
      expect(() => validateDatabaseDiskSize('dev', 50, 'aws')).not.toThrow();
    });

    it('should accept 128 GB on Azure', () => {
      expect(() => validateDatabaseDiskSize('dev', 128, 'azure')).not.toThrow();
    });
  });

  describe('Provider limits', () => {
    it('should reject AWS sizes below the 20 GB gp3 minimum', () => {
      const error = captureError(() =>
        validateDatabaseDiskSize('dev', 10, 'aws'),
      );

      expect(error.message).toContain('10 is not supported on AWS');
      expect(error.message).toContain('dev.database.diskSize');
      expect(error.hint).toContain('20 to 1000 GB');
    });

    it('should reject Azure sizes that are not offered', () => {
      const error = captureError(() =>
        validateDatabaseDiskSize('prod', 50, 'azure'),
      );

      expect(error.message).toContain('50 is not supported on AZURE');
      expect(error.hint).toContain('32, 64, 128, 256, 512');
    });

    it('should reject sizes above 1000 GB', () => {
      expect(() => validateDatabaseDiskSize('dev', 1001, 'gcp')).toThrow();
      expect(() => validateDatabaseDiskSize('dev', 1001, 'aws')).toThrow();
    });

    it('should reject GCP sizes below 10 GB', () => {
      expect(() => validateDatabaseDiskSize('dev', 5, 'gcp')).toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should reject a fractional size', () => {
      const error = captureError(() =>
        validateDatabaseDiskSize('dev', 20.5, 'aws'),
      );

      expect(error.message).toContain('whole number');
    });

    it('should reject a string size', () => {
      expect(() => validateDatabaseDiskSize('dev', '20', 'aws')).toThrow();
    });
  });
});
