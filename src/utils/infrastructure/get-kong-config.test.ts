import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { getKongConfig } from './get-kong-config';
import { KONG_DEFAULTS_GCP, KONG_DEFAULTS_AWS } from '../../constants';

describe('getKongConfig', () => {
  describe('GCP provider', () => {
    describe('returns defaults when no config', () => {
      it('should return all GCP defaults when config is null', () => {
        const result = getKongConfig(null, 'dev', 'gcp');
        expect(result).toEqual({
          minInstances: KONG_DEFAULTS_GCP.minInstances,
          maxInstances: KONG_DEFAULTS_GCP.maxInstances,
          cpu: KONG_DEFAULTS_GCP.cpu,
          memory: KONG_DEFAULTS_GCP.memory,
        });
      });

      it('should return all GCP defaults when environment does not exist', () => {
        const config = { prod: { kong: { minInstances: 2 } } };
        const result = getKongConfig(config, 'dev', 'gcp');
        expect(result.minInstances).toBe(KONG_DEFAULTS_GCP.minInstances);
      });

      it('should return all GCP defaults when env config is not an object', () => {
        const config = { dev: 'invalid' };
        const result = getKongConfig(
          config as Record<string, unknown>,
          'dev',
          'gcp',
        );
        expect(result.minInstances).toBe(KONG_DEFAULTS_GCP.minInstances);
      });

      it('should return all GCP defaults when no kong key in env config', () => {
        const config = { dev: { database: {} } };
        const result = getKongConfig(config, 'dev', 'gcp');
        expect(result.minInstances).toBe(KONG_DEFAULTS_GCP.minInstances);
      });
    });

    describe('merges environment overrides', () => {
      it('should merge kong override from dev environment', () => {
        const config = {
          dev: {
            kong: {
              minInstances: 0,
              maxInstances: 5,
              cpu: '1',
              memory: '1Gi',
            },
          },
        };
        const result = getKongConfig(config, 'dev', 'gcp');
        expect(result.minInstances).toBe(0);
        expect(result.maxInstances).toBe(5);
        expect(result.cpu).toBe('1');
        expect(result.memory).toBe('1Gi');
      });

      it('should merge kong override from prod environment', () => {
        const config = {
          dev: { kong: { minInstances: 0 } },
          prod: {
            kong: {
              minInstances: 2,
              maxInstances: 20,
              cpu: '2',
              memory: '2Gi',
            },
          },
        };
        const result = getKongConfig(config, 'prod', 'gcp');
        expect(result).toEqual({
          minInstances: 2,
          maxInstances: 20,
          cpu: '2',
          memory: '2Gi',
        });
      });

      it('should get correct environment-specific config', () => {
        const config = {
          dev: { kong: { minInstances: 0 } },
          staging: { kong: { minInstances: 1 } },
          prod: { kong: { minInstances: 2 } },
        };
        expect(getKongConfig(config, 'dev', 'gcp').minInstances).toBe(0);
        expect(getKongConfig(config, 'staging', 'gcp').minInstances).toBe(1);
        expect(getKongConfig(config, 'prod', 'gcp').minInstances).toBe(2);
      });
    });

    describe('edge cases', () => {
      it('should handle empty kong object', () => {
        const config = { dev: { kong: {} } };
        const result = getKongConfig(config, 'dev', 'gcp');
        expect(result).toEqual({
          minInstances: KONG_DEFAULTS_GCP.minInstances,
          maxInstances: KONG_DEFAULTS_GCP.maxInstances,
          cpu: KONG_DEFAULTS_GCP.cpu,
          memory: KONG_DEFAULTS_GCP.memory,
        });
      });

      it('should handle undefined kong value', () => {
        const config = { dev: { kong: undefined } };
        const result = getKongConfig(config, 'dev', 'gcp');
        expect(result.minInstances).toBe(KONG_DEFAULTS_GCP.minInstances);
      });

      it('should allow scale-to-zero for dev environments', () => {
        const config = {
          dev: {
            kong: { minInstances: 0, maxInstances: 5, cpu: '1', memory: '1Gi' },
          },
        };
        const result = getKongConfig(config, 'dev', 'gcp');
        expect(result.minInstances).toBe(0);
      });
    });
  });

  describe('AWS provider', () => {
    describe('returns defaults when no config', () => {
      it('should return all AWS defaults when config is null', () => {
        const result = getKongConfig(null, 'dev', 'aws');
        expect(result).toEqual({
          minInstances: KONG_DEFAULTS_AWS.minInstances,
          maxInstances: KONG_DEFAULTS_AWS.maxInstances,
          cpu: KONG_DEFAULTS_AWS.cpu,
          memory: KONG_DEFAULTS_AWS.memory,
        });
      });
    });

    describe('merges environment overrides', () => {
      it('should merge kong override with AWS defaults', () => {
        const config = {
          dev: {
            kong: {
              minInstances: 2,
              maxInstances: 10,
            },
          },
        };
        const result = getKongConfig(config, 'dev', 'aws');
        expect(result.minInstances).toBe(2);
        expect(result.maxInstances).toBe(10);
        expect(result.cpu).toBe(KONG_DEFAULTS_AWS.cpu);
        expect(result.memory).toBe(KONG_DEFAULTS_AWS.memory);
      });
    });
  });

  describe('provider-specific defaults differ', () => {
    it('should use GCP defaults for GCP provider', () => {
      const result = getKongConfig(null, 'dev', 'gcp');
      expect(result.memory).toBe('1Gi');
    });

    it('should use AWS defaults for AWS provider (2Gi required for 1 vCPU Fargate)', () => {
      const result = getKongConfig(null, 'dev', 'aws');
      expect(result.memory).toBe('2Gi');
    });
  });
});
