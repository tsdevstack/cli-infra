import { describe, it, expect } from '@rstest/core';
import { parseDbExportFileName } from './parse-db-export-file-name';

describe('parseDbExportFileName', () => {
  describe('Standard use cases', () => {
    it('should read the service, the time and the reason', () => {
      expect(
        parseDbExportFileName('auth-service/2026-11-14T12-30-05Z-removed.dump'),
      ).toEqual({
        name: 'auth-service/2026-11-14T12-30-05Z-removed.dump',
        serviceName: 'auth-service',
        time: new Date('2026-11-14T12:30:05Z'),
        reason: 'removed',
      });
    });

    it("should read a restore's own save", () => {
      expect(
        parseDbExportFileName(
          'auth-service/2026-11-14T13-05-00Z-before-restore.dump',
        )?.reason,
      ).toBe('before-restore');
    });
  });

  describe('Edge cases', () => {
    it('should skip any other file', () => {
      for (const name of [
        'auth-service/notes.txt',
        'auth-service/2026-11-14T12-30-05Z-other.dump',
        '2026-11-14T12-30-05Z-removed.dump',
        'auth-service/nested/2026-11-14T12-30-05Z-removed.dump',
        'auth-service/2026-13-45T99-99-99Z-removed.dump',
      ]) {
        expect(parseDbExportFileName(name)).toBeNull();
      }
    });
  });
});
