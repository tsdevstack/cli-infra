import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockPrompt, mockLogger } = rs.hoisted(() => ({
  mockPrompt: rs.fn(),
  mockLogger: { warn: rs.fn(), error: rs.fn(), info: rs.fn() },
}));

rs.mock('inquirer', () => ({ default: { prompt: mockPrompt } }));
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger }),
}));

import { saveDatabaseBeforeRemoval } from './save-database-before-removal';

const failure = () =>
  Object.assign(new Error('db-init (export) failed'), {
    hint: 'db-init failed: pg_dump failed (exit 1): connection refused',
  });

describe('saveDatabaseBeforeRemoval', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should save once when it works', async () => {
      const save = rs.fn(async () => {});

      const result = await saveDatabaseBeforeRemoval({
        save,
        interactive: true,
      });

      expect(result).toEqual({ outcome: 'saved' });
      expect(save).toHaveBeenCalledTimes(1);
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('should try once more on its own after a failure', async () => {
      const save = rs.fn(async () => {}).mockRejectedValueOnce(failure());

      const result = await saveDatabaseBeforeRemoval({
        save,
        interactive: true,
      });

      expect(result).toEqual({ outcome: 'saved' });
      expect(save).toHaveBeenCalledTimes(2);
      expect(mockPrompt).not.toHaveBeenCalled();
    });

    it('should stop in CI after two failures, naming --skip-export', async () => {
      const save = rs.fn(async () => {
        throw failure();
      });

      const result = await saveDatabaseBeforeRemoval({
        save,
        interactive: false,
      });

      expect(save).toHaveBeenCalledTimes(2);
      expect(mockPrompt).not.toHaveBeenCalled();
      expect(result.outcome).toBe('stopped');
      expect(result.outcome === 'stopped' && result.error).toContain(
        '--skip-export',
      );
      // The reason is shown
      const shown = mockLogger.error.mock.calls
        .map((call) => call[0])
        .join('\n');
      expect(shown).toContain('connection refused');
    });
  });

  describe('In a terminal, after two failures', () => {
    it('should stop by default', async () => {
      const save = rs.fn(async () => {
        throw failure();
      });
      mockPrompt.mockResolvedValue({ choice: 'stop' });

      const result = await saveDatabaseBeforeRemoval({
        save,
        interactive: true,
      });

      expect(result.outcome).toBe('stopped');
      expect(mockPrompt.mock.calls[0][0][0].default).toBe('stop');
    });

    it('should remove without saving when asked to', async () => {
      const save = rs.fn(async () => {
        throw failure();
      });
      mockPrompt.mockResolvedValue({ choice: 'skip' });

      const result = await saveDatabaseBeforeRemoval({
        save,
        interactive: true,
      });

      expect(result).toEqual({ outcome: 'skipped' });
      expect(save).toHaveBeenCalledTimes(2);
    });

    it('should try again when asked to, and ask again if it fails again', async () => {
      const save = rs
        .fn(async () => {})
        .mockRejectedValueOnce(failure())
        .mockRejectedValueOnce(failure())
        .mockRejectedValueOnce(failure());
      mockPrompt
        .mockResolvedValueOnce({ choice: 'retry' })
        .mockResolvedValueOnce({ choice: 'retry' });

      const result = await saveDatabaseBeforeRemoval({
        save,
        interactive: true,
      });

      expect(result).toEqual({ outcome: 'saved' });
      expect(save).toHaveBeenCalledTimes(4);
      expect(mockPrompt).toHaveBeenCalledTimes(2);
    });
  });
});
