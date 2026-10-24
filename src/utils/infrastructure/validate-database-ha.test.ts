import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateDatabaseHa } from './validate-database-ha';

function captureError(fn: () => void): { message: string; hint?: string } {
  try {
    fn();
  } catch (error) {
    return error as { message: string; hint?: string };
  }
  throw new Error('Expected function to throw');
}

describe('validateDatabaseHa', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should do nothing when ha is off, whatever the tier', () => {
      expect(() =>
        validateDatabaseHa(
          'dev',
          { tier: 'B_Standard_B1ms', ha: false, backup: false },
          'azure',
        ),
      ).not.toThrow();
    });

    it('should accept ha on an Azure General Purpose tier', () => {
      expect(() =>
        validateDatabaseHa(
          'prod',
          { tier: 'GP_Standard_D2s_v3', ha: true, backup: true },
          'azure',
        ),
      ).not.toThrow();
    });

    it('should accept ha on an Azure Memory Optimized tier', () => {
      expect(() =>
        validateDatabaseHa(
          'prod',
          { tier: 'MO_Standard_E4s_v3', ha: true, backup: false },
          'azure',
        ),
      ).not.toThrow();
    });

    it('should accept ha with backups on GCP', () => {
      expect(() =>
        validateDatabaseHa(
          'prod',
          { tier: 'db-f1-micro', ha: true, backup: true },
          'gcp',
        ),
      ).not.toThrow();
    });

    it('should accept ha without backups on AWS (Multi-AZ instance)', () => {
      expect(() =>
        validateDatabaseHa(
          'prod',
          { tier: 'db.t3.micro', ha: true, backup: false },
          'aws',
        ),
      ).not.toThrow();
    });
  });

  describe('Provider limits', () => {
    it('should reject ha on an Azure Burstable tier', () => {
      const error = captureError(() =>
        validateDatabaseHa(
          'prod',
          { tier: 'B_Standard_B2s', ha: true, backup: true },
          'azure',
        ),
      );

      expect(error.message).toContain('Burstable tier "B_Standard_B2s"');
      expect(error.message).toContain('prod.database');
      expect(error.hint).toContain('GP_Standard_D2s_v3');
    });

    it('should reject ha without backups on GCP', () => {
      const error = captureError(() =>
        validateDatabaseHa(
          'prod',
          { tier: 'db-g1-small', ha: true, backup: false },
          'gcp',
        ),
      );

      expect(error.message).toContain('needs "database.backup" on GCP');
      expect(error.hint).toContain('point-in-time recovery');
    });
  });
});
