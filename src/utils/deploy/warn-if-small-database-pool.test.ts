import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { warnIfSmallDatabasePool } from './warn-if-small-database-pool';

describe('warnIfSmallDatabasePool', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should warn when each instance gets a single connection', () => {
    warnIfSmallDatabasePool(
      { poolMax: 1, dbConnections: 25, totalInstances: 30 },
      'db-f1-micro',
    );

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Database pool: 1 connection per instance (db-f1-micro allows 25 connections, shared by up to 30 instances)',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Use a larger database tier, or lower maxInstances',
      ),
    );
  });

  it('should stay quiet from two connections per instance', () => {
    warnIfSmallDatabasePool(
      { poolMax: 2, dbConnections: 100, totalInstances: 45 },
      'db-g1-small',
    );

    expect(mocks.logger.warn).not.toHaveBeenCalled();
    expect(mocks.logger.info).not.toHaveBeenCalled();
  });
});
