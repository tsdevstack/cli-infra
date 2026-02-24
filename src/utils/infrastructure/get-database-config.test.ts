import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { getDatabaseConfig } from './get-database-config';
import { DATABASE_DEFAULTS_GCP, DATABASE_DEFAULTS_AWS } from '../../constants';

describe('getDatabaseConfig', () => {
  describe('GCP provider', () => {
    describe('returns defaults when no config', () => {
      it('should return all GCP defaults when config is null', () => {
        const result = getDatabaseConfig(null, 'dev', 'gcp');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_GCP.tier,
          diskSize: DATABASE_DEFAULTS_GCP.diskSize,
          deletionProtection: DATABASE_DEFAULTS_GCP.deletionProtection,
          ha: DATABASE_DEFAULTS_GCP.ha,
          backup: DATABASE_DEFAULTS_GCP.backup,
        });
      });

      it('should return all GCP defaults when environment does not exist', () => {
        const config = { prod: { database: { tier: 'db-g1-small' } } };
        const result = getDatabaseConfig(config, 'dev', 'gcp');
        expect(result.tier).toBe(DATABASE_DEFAULTS_GCP.tier);
      });

      it('should return all GCP defaults when env config is not an object', () => {
        const config = { dev: 'invalid' };
        const result = getDatabaseConfig(
          config as Record<string, unknown>,
          'dev',
          'gcp',
        );
        expect(result.tier).toBe(DATABASE_DEFAULTS_GCP.tier);
      });

      it('should return all GCP defaults when no database key in env config', () => {
        const config = { dev: { redis: {} } };
        const result = getDatabaseConfig(config, 'dev', 'gcp');
        expect(result.tier).toBe(DATABASE_DEFAULTS_GCP.tier);
      });
    });

    describe('merges environment overrides', () => {
      it('should merge database override from dev environment', () => {
        const config = {
          dev: {
            database: {
              tier: 'db-g1-small',
              diskSize: 20,
            },
          },
        };
        const result = getDatabaseConfig(config, 'dev', 'gcp');
        expect(result.tier).toBe('db-g1-small');
        expect(result.diskSize).toBe(20);
        expect(result.ha).toBe(DATABASE_DEFAULTS_GCP.ha);
        expect(result.backup).toBe(DATABASE_DEFAULTS_GCP.backup);
      });

      it('should merge database override from prod environment', () => {
        const config = {
          dev: { database: { tier: 'db-f1-micro' } },
          prod: {
            database: {
              tier: 'db-custom-4-16384',
              diskSize: 500,
              ha: true,
              backup: true,
            },
          },
        };
        const result = getDatabaseConfig(config, 'prod', 'gcp');
        expect(result).toEqual({
          tier: 'db-custom-4-16384',
          diskSize: 500,
          deletionProtection: DATABASE_DEFAULTS_GCP.deletionProtection,
          ha: true,
          backup: true,
        });
      });

      it('should get correct environment-specific config', () => {
        const config = {
          dev: { database: { diskSize: 10 } },
          staging: { database: { diskSize: 50 } },
          prod: { database: { diskSize: 200 } },
        };
        expect(getDatabaseConfig(config, 'dev', 'gcp').diskSize).toBe(10);
        expect(getDatabaseConfig(config, 'staging', 'gcp').diskSize).toBe(50);
        expect(getDatabaseConfig(config, 'prod', 'gcp').diskSize).toBe(200);
      });
    });

    describe('edge cases', () => {
      it('should handle empty database object', () => {
        const config = { dev: { database: {} } };
        const result = getDatabaseConfig(config, 'dev', 'gcp');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_GCP.tier,
          diskSize: DATABASE_DEFAULTS_GCP.diskSize,
          deletionProtection: DATABASE_DEFAULTS_GCP.deletionProtection,
          ha: DATABASE_DEFAULTS_GCP.ha,
          backup: DATABASE_DEFAULTS_GCP.backup,
        });
      });

      it('should handle undefined database value', () => {
        const config = { dev: { database: undefined } };
        const result = getDatabaseConfig(config, 'dev', 'gcp');
        expect(result.tier).toBe(DATABASE_DEFAULTS_GCP.tier);
      });
    });
  });

  describe('AWS provider', () => {
    describe('returns defaults when no config', () => {
      it('should return all AWS defaults when config is null', () => {
        const result = getDatabaseConfig(null, 'dev', 'aws');
        expect(result).toEqual({
          tier: DATABASE_DEFAULTS_AWS.tier,
          diskSize: DATABASE_DEFAULTS_AWS.diskSize,
          deletionProtection: DATABASE_DEFAULTS_AWS.deletionProtection,
          ha: DATABASE_DEFAULTS_AWS.ha,
          backup: DATABASE_DEFAULTS_AWS.backup,
        });
      });
    });

    describe('merges environment overrides', () => {
      it('should merge database override with AWS defaults', () => {
        const config = {
          dev: {
            database: {
              tier: 'db.t3.small',
              diskSize: 50,
            },
          },
        };
        const result = getDatabaseConfig(config, 'dev', 'aws');
        expect(result.tier).toBe('db.t3.small');
        expect(result.diskSize).toBe(50);
        expect(result.ha).toBe(DATABASE_DEFAULTS_AWS.ha);
        expect(result.backup).toBe(DATABASE_DEFAULTS_AWS.backup);
      });
    });
  });

  describe('provider-specific defaults differ', () => {
    it('should use GCP defaults for GCP provider', () => {
      const result = getDatabaseConfig(null, 'dev', 'gcp');
      expect(result.tier).toBe('db-f1-micro');
    });

    it('should use AWS defaults for AWS provider', () => {
      const result = getDatabaseConfig(null, 'dev', 'aws');
      expect(result.tier).toBe('db.t3.micro');
    });
  });
});
