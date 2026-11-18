import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockLogger = { info: rs.fn(), newline: rs.fn() };
rs.mock('../../context', () => ({
  getContext: () => ({ logger: mockLogger }),
}));
rs.mock('@tsdevstack/infra-core', () => ({ DB_EXPORT_RETENTION_DAYS: 7 }));

import { logDatabaseSavedHint } from './log-database-saved-hint';

describe('logDatabaseSavedHint', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it('should give the file, how long it stays and the restore command', () => {
      logDatabaseSavedHint(
        'auth-service',
        'dev',
        'gs://shop-db-exports-gcp-shop/auth-service/2026-11-14T12-30-00Z-removed.dump',
      );

      const lines = mockLogger.info.mock.calls.map((call) => call[0]);
      expect(lines).toEqual([
        'Database "auth-service" has been dropped. It was saved first, and the file is kept 7 days:',
        '  gs://shop-db-exports-gcp-shop/auth-service/2026-11-14T12-30-00Z-removed.dump',
        'To bring it back, deploy the service again (cloud-secrets:push, infra:deploy), then:',
        '  npx tsdevstack infra:restore-database auth-service --env dev',
      ]);
    });
  });
});
