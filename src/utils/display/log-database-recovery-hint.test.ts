import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockLogger = { info: rs.fn(), warn: rs.fn(), newline: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger }),
}));

import { logDatabaseRecoveryHint } from './log-database-recovery-hint';
import { REMOVED_SERVICE_DATA_DOCS_URL } from '../../constants';

describe('logDatabaseRecoveryHint', () => {
  const hint = {
    server: 'the shared Cloud SQL instance',
    backups: "the instance's backups (7 days, if backup is on)",
    restore: 'clone the instance to a time just before the removal',
    links: ['Console: https://console.example/backups'],
  };

  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should say where the data is and how to get it back without touching the live server', () => {
      logDatabaseRecoveryHint('auth-service', hint);

      const lines = mockLogger.info.mock.calls.map((call) => call[0]);
      expect(lines).toEqual([
        'Database "auth-service" has been dropped from the shared Cloud SQL instance.',
        "Its data is now only in the instance's backups (7 days, if backup is on). To get it back,",
        'clone the instance to a time just before the removal, then copy the "auth-service" database from it into the live one.',
        '  Console: https://console.example/backups',
        `  Guide: ${REMOVED_SERVICE_DATA_DOCS_URL}`,
      ]);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should warn about restoring onto the live server when the cloud allows it', () => {
      logDatabaseRecoveryHint('auth-service', {
        ...hint,
        inPlaceWarning: "Don't restore a backup onto the live instance.",
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Don't restore a backup onto the live instance.",
      );
    });
  });

  describe('Edge cases', () => {
    it('should point to the guide even without console links', () => {
      logDatabaseRecoveryHint('auth-service', { ...hint, links: [] });

      const lines = mockLogger.info.mock.calls.map((call) => call[0]);
      expect(lines).toContain(`  Guide: ${REMOVED_SERVICE_DATA_DOCS_URL}`);
      expect(lines.some((l) => l.includes('Console:'))).toBe(false);
    });
  });
});
