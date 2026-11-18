import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockLogger = { info: rs.fn(), newline: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger }),
}));

import { logRestoreDatabaseNextSteps } from './log-restore-database-next-steps';

describe('logRestoreDatabaseNextSteps', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should say how to undo the restore, and when to run the migrations', () => {
      logRestoreDatabaseNextSteps(
        'auth-service',
        'dev',
        'auth-service/2026-11-14T13-05-00Z-before-restore.dump',
      );

      const lines = mockLogger.info.mock.calls.map((call) => call[0]);
      expect(lines).toEqual([
        'To undo it, restore the file saved just before:',
        '  npx tsdevstack infra:restore-database auth-service --env dev --file auth-service/2026-11-14T13-05-00Z-before-restore.dump',
        "If the service's migrations are newer than the restored file:",
        '  npx tsdevstack infra:run-db-migrate --service auth-service --env dev',
      ]);
    });
  });
});
