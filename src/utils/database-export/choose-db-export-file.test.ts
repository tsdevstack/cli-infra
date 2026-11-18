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

import { chooseDbExportFile } from './choose-db-export-file';
import type { DbExportFile } from './types';

const file = (time: string, reason: DbExportFile['reason']): DbExportFile => ({
  name: `auth-service/${time.replace(/:/g, '-')}-${reason}.dump`,
  serviceName: 'auth-service',
  time: new Date(time),
  reason,
  size: 2048,
});

// Newest first, as listed
const files = [
  file('2026-11-14T13:05:00Z', 'before-restore'),
  file('2026-11-14T12:30:00Z', 'removed'),
  file('2026-11-13T09:00:00Z', 'removed'),
];

describe('chooseDbExportFile', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should take the newest file from a removal in CI, never a before-restore one', async () => {
      const chosen = await chooseDbExportFile({
        serviceName: 'auth-service',
        files,
        interactive: false,
      });

      expect(chosen.name).toBe(files[1].name);
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('should list every file in a terminal, that one preselected', async () => {
      mockPrompt.mockResolvedValue({ name: files[0].name });

      const chosen = await chooseDbExportFile({
        serviceName: 'auth-service',
        files,
        interactive: true,
      });

      const question = mockPrompt.mock.calls[0][0][0];
      expect(question.choices).toHaveLength(3);
      expect(question.default).toBe(files[1].name);
      // Picking the before-restore file undoes a restore
      expect(chosen.name).toBe(files[0].name);
    });

    it('should take the file named with --file', async () => {
      const chosen = await chooseDbExportFile({
        serviceName: 'auth-service',
        files,
        fileOption: files[2].name,
        interactive: true,
      });

      expect(chosen.name).toBe(files[2].name);
      expect(mockPrompt).not.toHaveBeenCalled();
    });
  });

  describe('Edge cases', () => {
    it('should fail on a --file that is not there, listing the files', async () => {
      await expect(
        chooseDbExportFile({
          serviceName: 'auth-service',
          files,
          fileOption: 'auth-service/nope.dump',
          interactive: false,
        }),
      ).rejects.toMatchObject({
        message: 'No saved file auth-service/nope.dump',
        hint: expect.stringContaining(files[1].name),
      });
    });

    it('should fail without files', async () => {
      await expect(
        chooseDbExportFile({
          serviceName: 'auth-service',
          files: [],
          interactive: true,
        }),
      ).rejects.toMatchObject({ message: 'auth-service has no saved files' });
    });

    it('should not pick a before-restore file on its own in CI', async () => {
      await expect(
        chooseDbExportFile({
          serviceName: 'auth-service',
          files: [files[0]],
          interactive: false,
        }),
      ).rejects.toMatchObject({
        message: 'auth-service has no file saved by infra:remove-service',
        hint: expect.stringContaining('--file'),
      });
    });
  });
});
