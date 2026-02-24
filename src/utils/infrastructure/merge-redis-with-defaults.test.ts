import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { mergeRedisWithDefaults } from './merge-redis-with-defaults';
import {
  REDIS_DEFAULTS_GCP,
  REDIS_DEFAULTS_AWS,
  REDIS_DEFAULTS_AZURE,
} from '../../constants';

describe('mergeRedisWithDefaults', () => {
  describe('GCP provider', () => {
    describe('returns defaults', () => {
      it('should return all GCP defaults when override is undefined', () => {
        const result = mergeRedisWithDefaults(undefined, 'gcp');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_GCP.tier,
          memoryGb: REDIS_DEFAULTS_GCP.memoryGb,
        });
      });

      it('should return all GCP defaults when override is empty object', () => {
        const result = mergeRedisWithDefaults({}, 'gcp');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_GCP.tier,
          memoryGb: REDIS_DEFAULTS_GCP.memoryGb,
        });
      });
    });

    describe('merges overrides', () => {
      it('should override tier only', () => {
        const result = mergeRedisWithDefaults({ tier: 'STANDARD_HA' }, 'gcp');
        expect(result.tier).toBe('STANDARD_HA');
        expect(result.memoryGb).toBe(REDIS_DEFAULTS_GCP.memoryGb);
      });

      it('should override memoryGb only', () => {
        const result = mergeRedisWithDefaults({ memoryGb: 4 }, 'gcp');
        expect(result.tier).toBe(REDIS_DEFAULTS_GCP.tier);
        expect(result.memoryGb).toBe(4);
      });

      it('should override all fields', () => {
        const result = mergeRedisWithDefaults(
          {
            tier: 'STANDARD_HA',
            memoryGb: 8,
          },
          'gcp',
        );
        expect(result).toEqual({
          tier: 'STANDARD_HA',
          memoryGb: 8,
        });
      });
    });
  });

  describe('AWS provider', () => {
    describe('returns defaults', () => {
      it('should return all AWS defaults when override is undefined', () => {
        const result = mergeRedisWithDefaults(undefined, 'aws');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_AWS.tier,
          memoryGb: REDIS_DEFAULTS_AWS.memoryGb,
        });
      });

      it('should return all AWS defaults when override is empty object', () => {
        const result = mergeRedisWithDefaults({}, 'aws');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_AWS.tier,
          memoryGb: REDIS_DEFAULTS_AWS.memoryGb,
        });
      });
    });

    describe('merges overrides', () => {
      it('should override tier only with AWS tier', () => {
        const result = mergeRedisWithDefaults(
          { tier: 'cache.t3.small' },
          'aws',
        );
        expect(result.tier).toBe('cache.t3.small');
        expect(result.memoryGb).toBe(REDIS_DEFAULTS_AWS.memoryGb);
      });

      it('should override all fields', () => {
        const result = mergeRedisWithDefaults(
          {
            tier: 'cache.r5.large',
            memoryGb: 16,
          },
          'aws',
        );
        expect(result).toEqual({
          tier: 'cache.r5.large',
          memoryGb: 16,
        });
      });
    });
  });

  describe('Azure provider', () => {
    describe('returns defaults', () => {
      it('should return all Azure defaults when override is undefined', () => {
        const result = mergeRedisWithDefaults(undefined, 'azure');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_AZURE.tier,
          memoryGb: REDIS_DEFAULTS_AZURE.memoryGb,
        });
      });

      it('should return all Azure defaults when override is empty object', () => {
        const result = mergeRedisWithDefaults({}, 'azure');
        expect(result).toEqual({
          tier: REDIS_DEFAULTS_AZURE.tier,
          memoryGb: REDIS_DEFAULTS_AZURE.memoryGb,
        });
      });
    });

    describe('merges overrides', () => {
      it('should override tier only with Azure tier', () => {
        const result = mergeRedisWithDefaults({ tier: 'Balanced_B1' }, 'azure');
        expect(result.tier).toBe('Balanced_B1');
        expect(result.memoryGb).toBe(REDIS_DEFAULTS_AZURE.memoryGb);
      });

      it('should override all fields', () => {
        const result = mergeRedisWithDefaults(
          { tier: 'MemoryOptimized_M10', memoryGb: 10 },
          'azure',
        );
        expect(result).toEqual({
          tier: 'MemoryOptimized_M10',
          memoryGb: 10,
        });
      });
    });
  });

  describe('provider-specific defaults differ', () => {
    it('should have different default tiers for GCP vs AWS vs Azure', () => {
      const gcpResult = mergeRedisWithDefaults(undefined, 'gcp');
      const awsResult = mergeRedisWithDefaults(undefined, 'aws');
      const azureResult = mergeRedisWithDefaults(undefined, 'azure');
      expect(gcpResult.tier).toBe('BASIC'); // GCP Memorystore
      expect(awsResult.tier).toBe('cache.t3.micro'); // AWS ElastiCache
      expect(azureResult.tier).toBe('Balanced_B0'); // Azure Managed Redis
    });
  });
});
