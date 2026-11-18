import { describe, it, expect } from '@rstest/core';
import { formatDbExportFile } from './format-db-export-file';

const file = (reason: 'removed' | 'before-restore', size: number) => ({
  name: `auth-service/2026-11-14T12-30-05Z-${reason}.dump`,
  serviceName: 'auth-service',
  time: new Date('2026-11-14T12:30:05Z'),
  reason,
  size,
});

describe('formatDbExportFile', () => {
  describe('Standard use cases', () => {
    it('should show when, why and how big', () => {
      expect(formatDbExportFile(file('removed', 1.5 * 1024 * 1024))).toBe(
        '2026-11-14 12:30:05 UTC  removed         1.5 MB',
      );
    });

    it('should line up both reasons', () => {
      expect(formatDbExportFile(file('before-restore', 4096))).toBe(
        '2026-11-14 12:30:05 UTC  before-restore  4 KB',
      );
    });
  });

  describe('Edge cases', () => {
    it('should show a tiny file as 1 KB', () => {
      expect(formatDbExportFile(file('removed', 10))).toContain('1 KB');
    });
  });
});
