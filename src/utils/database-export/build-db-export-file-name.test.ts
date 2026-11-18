import { describe, it, expect, rs } from '@rstest/core';

rs.mock('@tsdevstack/infra-core', () => ({
  DB_EXPORT_FILE_EXTENSION: '.dump',
}));

import { buildDbExportFileName } from './build-db-export-file-name';

describe('buildDbExportFileName', () => {
  describe('Standard use cases', () => {
    it('should put the file in the service folder, with the UTC time and the reason', () => {
      expect(
        buildDbExportFileName(
          'auth-service',
          'removed',
          new Date('2026-11-14T12:30:05.123Z'),
        ),
      ).toBe('auth-service/2026-11-14T12-30-05Z-removed.dump');
    });

    it("should name a restore's own save before-restore", () => {
      expect(
        buildDbExportFileName(
          'auth-service',
          'before-restore',
          new Date('2026-11-14T13:05:00.000Z'),
        ),
      ).toBe('auth-service/2026-11-14T13-05-00Z-before-restore.dump');
    });
  });

  describe('Edge cases', () => {
    it('should have no colon, which some file stores refuse', () => {
      expect(buildDbExportFileName('a', 'removed')).not.toContain(':');
    });
  });
});
