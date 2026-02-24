import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { getServiceConfig } from './get-service-config';
import {
  INFRASTRUCTURE_DEFAULTS_GCP,
  INFRASTRUCTURE_DEFAULTS_AWS,
} from '../../constants';

describe('getServiceConfig', () => {
  describe('GCP provider', () => {
    describe('returns defaults when no config', () => {
      it('should return all GCP defaults when config is null', () => {
        const result = getServiceConfig(null, 'auth-service', 'dev', 'gcp');
        expect(result).toEqual({
          minInstances: INFRASTRUCTURE_DEFAULTS_GCP.minInstances,
          maxInstances: INFRASTRUCTURE_DEFAULTS_GCP.maxInstances,
          cpu: INFRASTRUCTURE_DEFAULTS_GCP.cpu,
          memory: INFRASTRUCTURE_DEFAULTS_GCP.memory,
          timeout: INFRASTRUCTURE_DEFAULTS_GCP.timeout,
          port: INFRASTRUCTURE_DEFAULTS_GCP.port,
          concurrency: INFRASTRUCTURE_DEFAULTS_GCP.concurrency,
        });
      });

      it('should return all GCP defaults when environment does not exist', () => {
        const config = { prod: { 'auth-service': { minInstances: 2 } } };
        const result = getServiceConfig(config, 'auth-service', 'dev', 'gcp');
        expect(result.minInstances).toBe(
          INFRASTRUCTURE_DEFAULTS_GCP.minInstances,
        );
      });

      it('should return all GCP defaults when env config is not an object', () => {
        const config = { dev: 'invalid' };
        const result = getServiceConfig(
          config as Record<string, unknown>,
          'auth-service',
          'dev',
          'gcp',
        );
        expect(result.minInstances).toBe(
          INFRASTRUCTURE_DEFAULTS_GCP.minInstances,
        );
      });

      it('should return all GCP defaults when service not in env config', () => {
        const config = { dev: { 'other-service': { minInstances: 5 } } };
        const result = getServiceConfig(config, 'auth-service', 'dev', 'gcp');
        expect(result.minInstances).toBe(
          INFRASTRUCTURE_DEFAULTS_GCP.minInstances,
        );
      });
    });

    describe('merges environment overrides', () => {
      it('should merge service override from config', () => {
        const config = {
          dev: {
            'auth-service': {
              minInstances: 1,
              maxInstances: 5,
              cpu: '2',
            },
          },
        };
        const result = getServiceConfig(config, 'auth-service', 'dev', 'gcp');
        expect(result.minInstances).toBe(1);
        expect(result.maxInstances).toBe(5);
        expect(result.cpu).toBe('2');
        expect(result.memory).toBe(INFRASTRUCTURE_DEFAULTS_GCP.memory);
      });

      it('should get correct service-specific config', () => {
        const config = {
          dev: {
            'auth-service': { minInstances: 1 },
            'api-service': { minInstances: 2 },
            'bff-service': { minInstances: 3 },
          },
        };
        expect(
          getServiceConfig(config, 'auth-service', 'dev', 'gcp').minInstances,
        ).toBe(1);
        expect(
          getServiceConfig(config, 'api-service', 'dev', 'gcp').minInstances,
        ).toBe(2);
        expect(
          getServiceConfig(config, 'bff-service', 'dev', 'gcp').minInstances,
        ).toBe(3);
      });

      it('should get correct environment-specific config', () => {
        const config = {
          dev: { 'auth-service': { minInstances: 0 } },
          staging: { 'auth-service': { minInstances: 1 } },
          prod: { 'auth-service': { minInstances: 2 } },
        };
        expect(
          getServiceConfig(config, 'auth-service', 'dev', 'gcp').minInstances,
        ).toBe(0);
        expect(
          getServiceConfig(config, 'auth-service', 'staging', 'gcp')
            .minInstances,
        ).toBe(1);
        expect(
          getServiceConfig(config, 'auth-service', 'prod', 'gcp').minInstances,
        ).toBe(2);
      });
    });

    describe('all override fields', () => {
      it('should merge all override fields', () => {
        const config = {
          prod: {
            'api-service': {
              minInstances: 2,
              maxInstances: 20,
              cpu: '4',
              memory: '2Gi',
              timeout: '600s',
              port: 8080,
              concurrency: 200,
            },
          },
        };
        const result = getServiceConfig(config, 'api-service', 'prod', 'gcp');
        expect(result).toEqual({
          minInstances: 2,
          maxInstances: 20,
          cpu: '4',
          memory: '2Gi',
          timeout: '600s',
          port: 8080,
          concurrency: 200,
        });
      });
    });

    describe('edge cases', () => {
      it('should handle empty service override object', () => {
        const config = { dev: { 'auth-service': {} } };
        const result = getServiceConfig(config, 'auth-service', 'dev', 'gcp');
        expect(result.minInstances).toBe(
          INFRASTRUCTURE_DEFAULTS_GCP.minInstances,
        );
      });

      it('should handle undefined service value', () => {
        const config = { dev: { 'auth-service': undefined } };
        const result = getServiceConfig(config, 'auth-service', 'dev', 'gcp');
        expect(result.minInstances).toBe(
          INFRASTRUCTURE_DEFAULTS_GCP.minInstances,
        );
      });
    });
  });

  describe('AWS provider', () => {
    describe('returns defaults when no config', () => {
      it('should return all AWS defaults when config is null', () => {
        const result = getServiceConfig(null, 'auth-service', 'dev', 'aws');
        expect(result).toEqual({
          minInstances: INFRASTRUCTURE_DEFAULTS_AWS.minInstances,
          maxInstances: INFRASTRUCTURE_DEFAULTS_AWS.maxInstances,
          cpu: INFRASTRUCTURE_DEFAULTS_AWS.cpu,
          memory: INFRASTRUCTURE_DEFAULTS_AWS.memory,
          timeout: INFRASTRUCTURE_DEFAULTS_AWS.timeout,
          port: INFRASTRUCTURE_DEFAULTS_AWS.port,
          concurrency: INFRASTRUCTURE_DEFAULTS_AWS.concurrency,
        });
      });
    });

    describe('merges environment overrides', () => {
      it('should merge service override with AWS defaults', () => {
        const config = {
          dev: {
            'auth-service': {
              minInstances: 0,
              maxInstances: 5,
              cpu: '1',
              memory: '2Gi',
            },
          },
        };
        const result = getServiceConfig(config, 'auth-service', 'dev', 'aws');
        expect(result.minInstances).toBe(0);
        expect(result.maxInstances).toBe(5);
        expect(result.cpu).toBe('1');
        expect(result.memory).toBe('2Gi');
        expect(result.timeout).toBe(INFRASTRUCTURE_DEFAULTS_AWS.timeout);
      });
    });
  });

  describe('provider-specific defaults differ', () => {
    it('should use GCP defaults for GCP provider', () => {
      const result = getServiceConfig(null, 'test', 'dev', 'gcp');
      expect(result.cpu).toBe('1');
      expect(result.memory).toBe('512Mi');
    });

    it('should use AWS defaults for AWS provider (0.5 vCPU + 1Gi valid Fargate combo)', () => {
      const result = getServiceConfig(null, 'test', 'dev', 'aws');
      expect(result.cpu).toBe('0.5');
      expect(result.memory).toBe('1Gi');
    });
  });
});
