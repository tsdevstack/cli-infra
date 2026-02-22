import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { mergeServiceWithDefaults } from './merge-service-with-defaults';
import {
  INFRASTRUCTURE_DEFAULTS_GCP,
  INFRASTRUCTURE_DEFAULTS_AWS,
  INFRASTRUCTURE_DEFAULTS_AZURE,
} from '../../constants';

describe('mergeServiceWithDefaults', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('GCP provider', () => {
    describe('returns defaults', () => {
      it('should return all GCP defaults when override is undefined', () => {
        const result = mergeServiceWithDefaults(
          undefined,
          'auth-service',
          'dev',
          'gcp',
        );
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

      it('should return all GCP defaults when override is empty object', () => {
        const result = mergeServiceWithDefaults(
          {},
          'auth-service',
          'dev',
          'gcp',
        );
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
    });

    describe('merges individual overrides', () => {
      it('should override minInstances only', () => {
        const result = mergeServiceWithDefaults(
          { minInstances: 2 },
          'api-service',
          'prod',
          'gcp',
        );
        expect(result.minInstances).toBe(2);
        expect(result.maxInstances).toBe(
          INFRASTRUCTURE_DEFAULTS_GCP.maxInstances,
        );
      });

      it('should override maxInstances only', () => {
        const result = mergeServiceWithDefaults(
          { maxInstances: 20 },
          'api-service',
          'prod',
          'gcp',
        );
        expect(result.minInstances).toBe(
          INFRASTRUCTURE_DEFAULTS_GCP.minInstances,
        );
        expect(result.maxInstances).toBe(20);
      });

      it('should override cpu only', () => {
        const result = mergeServiceWithDefaults(
          { cpu: '2' },
          'api-service',
          'prod',
          'gcp',
        );
        expect(result.cpu).toBe('2');
        expect(result.memory).toBe(INFRASTRUCTURE_DEFAULTS_GCP.memory);
      });

      it('should override memory only', () => {
        const result = mergeServiceWithDefaults(
          { memory: '1Gi' },
          'api-service',
          'prod',
          'gcp',
        );
        expect(result.memory).toBe('1Gi');
        expect(result.cpu).toBe(INFRASTRUCTURE_DEFAULTS_GCP.cpu);
      });

      it('should override timeout only', () => {
        const result = mergeServiceWithDefaults(
          { timeout: '600s' },
          'api-service',
          'prod',
          'gcp',
        );
        expect(result.timeout).toBe('600s');
      });

      it('should override port only', () => {
        const result = mergeServiceWithDefaults(
          { port: 8080 },
          'api-service',
          'prod',
          'gcp',
        );
        expect(result.port).toBe(8080);
      });

      it('should override concurrency only', () => {
        const result = mergeServiceWithDefaults(
          { concurrency: 200 },
          'api-service',
          'prod',
          'gcp',
        );
        expect(result.concurrency).toBe(200);
      });
    });

    describe('merges all overrides', () => {
      it('should merge complete override', () => {
        const result = mergeServiceWithDefaults(
          {
            minInstances: 2,
            maxInstances: 50,
            cpu: '4',
            memory: '2Gi',
            timeout: '300s',
            port: 3000,
            concurrency: 500,
          },
          'api-service',
          'prod',
          'gcp',
        );
        expect(result).toEqual({
          minInstances: 2,
          maxInstances: 50,
          cpu: '4',
          memory: '2Gi',
          timeout: '300s',
          port: 3000,
          concurrency: 500,
        });
      });
    });
  });

  describe('AWS provider', () => {
    describe('returns defaults', () => {
      it('should return all AWS defaults when override is undefined', () => {
        const result = mergeServiceWithDefaults(
          undefined,
          'auth-service',
          'dev',
          'aws',
        );
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

    describe('merges overrides', () => {
      it('should merge complete override', () => {
        const result = mergeServiceWithDefaults(
          {
            minInstances: 2,
            maxInstances: 50,
            cpu: '1',
            memory: '2Gi',
            timeout: '300s',
            port: 3000,
            concurrency: 500,
          },
          'api-service',
          'prod',
          'aws',
        );
        expect(result).toEqual({
          minInstances: 2,
          maxInstances: 50,
          cpu: '1',
          memory: '2Gi',
          timeout: '300s',
          port: 3000,
          concurrency: 500,
        });
      });
    });
  });

  describe('Azure provider', () => {
    describe('returns defaults', () => {
      it('should return all Azure defaults when override is undefined', () => {
        const result = mergeServiceWithDefaults(
          undefined,
          'auth-service',
          'dev',
          'azure',
        );
        expect(result).toEqual({
          minInstances: INFRASTRUCTURE_DEFAULTS_AZURE.minInstances,
          maxInstances: INFRASTRUCTURE_DEFAULTS_AZURE.maxInstances,
          cpu: INFRASTRUCTURE_DEFAULTS_AZURE.cpu,
          memory: INFRASTRUCTURE_DEFAULTS_AZURE.memory,
          timeout: INFRASTRUCTURE_DEFAULTS_AZURE.timeout,
          port: INFRASTRUCTURE_DEFAULTS_AZURE.port,
          concurrency: INFRASTRUCTURE_DEFAULTS_AZURE.concurrency,
        });
      });
    });

    describe('merges overrides', () => {
      it('should merge complete override', () => {
        const result = mergeServiceWithDefaults(
          {
            minInstances: 1,
            maxInstances: 10,
            cpu: '0.5',
            memory: '1Gi',
            timeout: '600s',
            port: 8080,
            concurrency: 100,
          },
          'api-service',
          'prod',
          'azure',
        );
        expect(result).toEqual({
          minInstances: 1,
          maxInstances: 10,
          cpu: '0.5',
          memory: '1Gi',
          timeout: '600s',
          port: 8080,
          concurrency: 100,
        });
      });
    });
  });

  describe('provider-specific defaults differ', () => {
    it('should have different default cpu and memory for GCP vs AWS vs Azure', () => {
      const gcpResult = mergeServiceWithDefaults(
        undefined,
        'test',
        'dev',
        'gcp',
      );
      const awsResult = mergeServiceWithDefaults(
        undefined,
        'test',
        'dev',
        'aws',
      );
      const azureResult = mergeServiceWithDefaults(
        undefined,
        'test',
        'dev',
        'azure',
      );
      // GCP allows 1 vCPU with 512Mi
      expect(gcpResult.cpu).toBe('1');
      expect(gcpResult.memory).toBe('512Mi');
      // AWS Fargate requires valid combinations (0.5 vCPU needs at least 1Gi)
      expect(awsResult.cpu).toBe('0.5');
      expect(awsResult.memory).toBe('1Gi');
      // Azure Container Apps
      expect(azureResult.cpu).toBe('0.25');
      expect(azureResult.memory).toBe('0.5Gi');
      expect(azureResult.minInstances).toBe(0); // Scale-to-zero by default
    });
  });

  describe('min/max validation after merge', () => {
    it('should throw when minInstances > maxInstances after merge', () => {
      // Override minInstances to be higher than default maxInstances
      expect(() =>
        mergeServiceWithDefaults(
          { minInstances: 200 },
          'auth-service',
          'dev',
          'gcp',
        ),
      ).toThrow(mocks.CliError);
    });

    it('should include service name in error message', () => {
      try {
        mergeServiceWithDefaults(
          { minInstances: 200 },
          'my-service',
          'dev',
          'gcp',
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('my-service');
      }
    });

    it('should include environment in error message', () => {
      try {
        mergeServiceWithDefaults(
          { minInstances: 200 },
          'auth-service',
          'production',
          'gcp',
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('production');
      }
    });

    it('should include both values in error message', () => {
      try {
        mergeServiceWithDefaults(
          { minInstances: 200 },
          'auth-service',
          'dev',
          'gcp',
        );
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('200');
        expect((error as Error).message).toContain('minInstances');
        expect((error as Error).message).toContain('maxInstances');
      }
    });

    it('should allow equal min and max', () => {
      const result = mergeServiceWithDefaults(
        { minInstances: 5, maxInstances: 5 },
        'auth-service',
        'dev',
        'gcp',
      );
      expect(result.minInstances).toBe(5);
      expect(result.maxInstances).toBe(5);
    });
  });
});
