import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const { mockPrompt } = rs.hoisted(() => ({ mockPrompt: rs.fn() }));

rs.mock('inquirer', () => ({ default: { prompt: mockPrompt } }));
rs.mock('@tsdevstack/infra-core', () => ({ DB_EXPORT_RETENTION_DAYS: 7 }));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { chooseDbExportService } from './choose-db-export-service';
import type { DbExportFile } from './types';

const file = (
  serviceName: string,
  time: string,
  reason: DbExportFile['reason'] = 'removed',
): DbExportFile => ({
  name: `${serviceName}/${time.replace(/:/g, '-')}-${reason}.dump`,
  serviceName,
  time: new Date(time),
  reason,
  size: 2048,
});

describe('chooseDbExportService', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should list the services with saved files, newest first, and return the pick', async () => {
      mockPrompt.mockResolvedValue({ serviceName: 'offers-service' });

      const chosen = await chooseDbExportService([
        file('auth-service', '2026-11-14T13:20:40Z', 'before-restore'),
        file('offers-service', '2026-11-14T10:00:00Z'),
        file('auth-service', '2026-11-13T09:00:00Z'),
      ]);

      expect(chosen).toBe('offers-service');
      expect(mockPrompt.mock.calls[0][0][0].choices).toEqual([
        {
          name: 'auth-service  (2 saved, newest 2026-11-14 13:20:40 UTC)',
          value: 'auth-service',
        },
        {
          name: 'offers-service  (1 saved, newest 2026-11-14 10:00:00 UTC)',
          value: 'offers-service',
        },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should fail when nothing is saved', async () => {
      await expect(chooseDbExportService([])).rejects.toMatchObject({
        message: 'No saved databases in this environment',
      });
      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });
});
