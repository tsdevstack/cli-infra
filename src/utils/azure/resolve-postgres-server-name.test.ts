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

import { resolvePostgresServerName } from './resolve-postgres-server-name';

describe('resolvePostgresServerName', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Default name', () => {
    it('should return {project}-{env}-postgres when infrastructure.json is missing', () => {
      expect(resolvePostgresServerName('myproject', 'dev', null)).toEqual({
        name: 'myproject-dev-postgres',
        isOverride: false,
      });
    });

    it('should return the default when the environment has no overrides', () => {
      expect(
        resolvePostgresServerName('myproject', 'staging', {
          version: '1.0.0',
          dev: { database: { serverName: 'other-dev-postgres' } },
        }),
      ).toEqual({ name: 'myproject-staging-postgres', isOverride: false });
    });

    it('should return the default when database has no serverName', () => {
      expect(
        resolvePostgresServerName('myproject', 'dev', {
          version: '1.0.0',
          dev: { database: { deletionProtection: false } },
        }),
      ).toEqual({ name: 'myproject-dev-postgres', isOverride: false });
    });
  });

  describe('Override', () => {
    it('should return database.serverName when set', () => {
      expect(
        resolvePostgresServerName('myproject', 'dev', {
          version: '1.0.0',
          dev: { database: { serverName: 'myproject-dev-postgres-2' } },
        }),
      ).toEqual({ name: 'myproject-dev-postgres-2', isOverride: true });
    });

    it('should resolve per environment', () => {
      const infraConfig = {
        version: '1.0.0',
        dev: { database: { serverName: 'myproject-dev-pg' } },
        prod: { database: { tier: 'GP_Standard_D2s_v3' } },
      };
      expect(
        resolvePostgresServerName('myproject', 'dev', infraConfig),
      ).toEqual({ name: 'myproject-dev-pg', isOverride: true });
      expect(
        resolvePostgresServerName('myproject', 'prod', infraConfig),
      ).toEqual({ name: 'myproject-prod-postgres', isOverride: false });
    });
  });

  describe('Edge cases', () => {
    it('should throw a CliError when the override breaks Azure naming rules', () => {
      expect(() =>
        resolvePostgresServerName('myproject', 'dev', {
          version: '1.0.0',
          dev: { database: { serverName: 'Bad_Name' } },
        }),
      ).toThrow(mocks.CliError);
    });

    it('should throw a CliError when the override is too short', () => {
      expect(() =>
        resolvePostgresServerName('myproject', 'dev', {
          version: '1.0.0',
          dev: { database: { serverName: 'pg' } },
        }),
      ).toThrow('3 to 63 characters');
    });
  });
});
