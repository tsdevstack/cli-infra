import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { getRedisConfig } from './get-redis-config';
import { REDIS_DEFAULTS_GCP, REDIS_DEFAULTS_AWS } from '../../constants';

describe('getRedisConfig', () => {
  describe('GCP provider', () => {
    describe('returns defaults when no config', () => {
      it('should return all GCP defaults when config is null', () => {
        const result = getRedisConfig(null, 'dev', 'gcp');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_GCP.tier,
          memoryGb: REDIS_DEFAULTS_GCP.memoryGb,
        });
      });

      it('should return all GCP defaults when environment does not exist', () => {
        const config = { prod: { redis: { tier: 'STANDARD_HA' } } };
        const result = getRedisConfig(config, 'dev', 'gcp');
        expect(result.tier).toBe(REDIS_DEFAULTS_GCP.tier);
      });

      it('should return all GCP defaults when env config is not an object', () => {
        const config = { dev: 'invalid' };
        const result = getRedisConfig(
          config as Record<string, unknown>,
          'dev',
          'gcp',
        );
        expect(result.tier).toBe(REDIS_DEFAULTS_GCP.tier);
      });

      it('should return all GCP defaults when no redis key in env config', () => {
        const config = { dev: { database: {} } };
        const result = getRedisConfig(config, 'dev', 'gcp');
        expect(result.tier).toBe(REDIS_DEFAULTS_GCP.tier);
      });
    });

    describe('merges environment overrides', () => {
      it('should merge redis override from dev environment', () => {
        const config = {
          dev: {
            redis: {
              tier: 'BASIC',
              memoryGb: 2,
            },
          },
        };
        const result = getRedisConfig(config, 'dev', 'gcp');
        expect(result.tier).toBe('BASIC');
        expect(result.memoryGb).toBe(2);
      });

      it('should merge redis override from prod environment', () => {
        const config = {
          dev: { redis: { memoryGb: 1 } },
          prod: {
            redis: {
              tier: 'STANDARD_HA',
              memoryGb: 16,
            },
          },
        };
        const result = getRedisConfig(config, 'prod', 'gcp');
        expect(result).toEqual({
          tier: 'STANDARD_HA',
          memoryGb: 16,
        });
      });

      it('should get correct environment-specific config', () => {
        const config = {
          dev: { redis: { memoryGb: 1 } },
          staging: { redis: { memoryGb: 4 } },
          prod: { redis: { memoryGb: 16 } },
        };
        expect(getRedisConfig(config, 'dev', 'gcp').memoryGb).toBe(1);
        expect(getRedisConfig(config, 'staging', 'gcp').memoryGb).toBe(4);
        expect(getRedisConfig(config, 'prod', 'gcp').memoryGb).toBe(16);
      });
    });

    describe('edge cases', () => {
      it('should handle empty redis object', () => {
        const config = { dev: { redis: {} } };
        const result = getRedisConfig(config, 'dev', 'gcp');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_GCP.tier,
          memoryGb: REDIS_DEFAULTS_GCP.memoryGb,
        });
      });

      it('should handle undefined redis value', () => {
        const config = { dev: { redis: undefined } };
        const result = getRedisConfig(config, 'dev', 'gcp');
        expect(result.tier).toBe(REDIS_DEFAULTS_GCP.tier);
      });
    });
  });

  describe('AWS provider', () => {
    describe('returns defaults when no config', () => {
      it('should return all AWS defaults when config is null', () => {
        const result = getRedisConfig(null, 'dev', 'aws');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_AWS.tier,
          memoryGb: REDIS_DEFAULTS_AWS.memoryGb,
        });
      });
    });

    describe('merges environment overrides', () => {
      it('should merge redis override with AWS defaults', () => {
        const config = {
          dev: {
            redis: {
              tier: 'cache.t3.small',
              memoryGb: 4,
            },
          },
        };
        const result = getRedisConfig(config, 'dev', 'aws');
        expect(result.tier).toBe('cache.t3.small');
        expect(result.memoryGb).toBe(4);
      });
    });
  });

  describe('provider-specific defaults differ', () => {
    it('should use GCP defaults for GCP provider', () => {
      const result = getRedisConfig(null, 'dev', 'gcp');
      expect(result.tier).toBe('BASIC');
    });

    it('should use AWS defaults for AWS provider', () => {
      const result = getRedisConfig(null, 'dev', 'aws');
      expect(result.tier).toBe('cache.t3.micro');
    });
  });
});
