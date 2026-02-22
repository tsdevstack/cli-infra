import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { mergeKongWithDefaults } from './merge-kong-with-defaults';
import {
  KONG_DEFAULTS_GCP,
  KONG_DEFAULTS_AWS,
  KONG_DEFAULTS_AZURE,
} from '../../constants';

describe('mergeKongWithDefaults', () => {
  describe('GCP provider', () => {
    describe('returns defaults when no override', () => {
      it('should return all GCP defaults when override is undefined', () => {
        const result = mergeKongWithDefaults(undefined, 'gcp');
        expect(result).toEqual({
          minInstances: KONG_DEFAULTS_GCP.minInstances,
          maxInstances: KONG_DEFAULTS_GCP.maxInstances,
          cpu: KONG_DEFAULTS_GCP.cpu,
          memory: KONG_DEFAULTS_GCP.memory,
        });
      });
    });

    describe('merges overrides with defaults', () => {
      it('should override minInstances only', () => {
        const result = mergeKongWithDefaults({ minInstances: 0 }, 'gcp');
        expect(result.minInstances).toBe(0);
        expect(result.maxInstances).toBe(KONG_DEFAULTS_GCP.maxInstances);
        expect(result.cpu).toBe(KONG_DEFAULTS_GCP.cpu);
        expect(result.memory).toBe(KONG_DEFAULTS_GCP.memory);
      });

      it('should override maxInstances only', () => {
        const result = mergeKongWithDefaults({ maxInstances: 5 }, 'gcp');
        expect(result.minInstances).toBe(KONG_DEFAULTS_GCP.minInstances);
        expect(result.maxInstances).toBe(5);
      });

      it('should override cpu only', () => {
        const result = mergeKongWithDefaults({ cpu: '2' }, 'gcp');
        expect(result.cpu).toBe('2');
        expect(result.memory).toBe(KONG_DEFAULTS_GCP.memory);
      });

      it('should override memory only', () => {
        const result = mergeKongWithDefaults({ memory: '2Gi' }, 'gcp');
        expect(result.memory).toBe('2Gi');
        expect(result.cpu).toBe(KONG_DEFAULTS_GCP.cpu);
      });

      it('should override all fields', () => {
        const result = mergeKongWithDefaults(
          {
            minInstances: 0,
            maxInstances: 3,
            cpu: '0.5',
            memory: '512Mi',
          },
          'gcp',
        );
        expect(result).toEqual({
          minInstances: 0,
          maxInstances: 3,
          cpu: '0.5',
          memory: '512Mi',
        });
      });
    });

    describe('edge cases', () => {
      it('should handle empty override object', () => {
        const result = mergeKongWithDefaults({}, 'gcp');
        expect(result).toEqual({
          minInstances: KONG_DEFAULTS_GCP.minInstances,
          maxInstances: KONG_DEFAULTS_GCP.maxInstances,
          cpu: KONG_DEFAULTS_GCP.cpu,
          memory: KONG_DEFAULTS_GCP.memory,
        });
      });

      it('should handle minInstances of 0 (scale to zero)', () => {
        const result = mergeKongWithDefaults({ minInstances: 0 }, 'gcp');
        expect(result.minInstances).toBe(0);
      });
    });
  });

  describe('AWS provider', () => {
    describe('returns defaults when no override', () => {
      it('should return all AWS defaults when override is undefined', () => {
        const result = mergeKongWithDefaults(undefined, 'aws');
        expect(result).toEqual({
          minInstances: KONG_DEFAULTS_AWS.minInstances,
          maxInstances: KONG_DEFAULTS_AWS.maxInstances,
          cpu: KONG_DEFAULTS_AWS.cpu,
          memory: KONG_DEFAULTS_AWS.memory,
        });
      });
    });

    describe('merges overrides with defaults', () => {
      it('should override all fields', () => {
        const result = mergeKongWithDefaults(
          {
            minInstances: 2,
            maxInstances: 10,
            cpu: '2',
            memory: '4Gi',
          },
          'aws',
        );
        expect(result).toEqual({
          minInstances: 2,
          maxInstances: 10,
          cpu: '2',
          memory: '4Gi',
        });
      });
    });
  });

  describe('Azure provider', () => {
    describe('returns defaults when no override', () => {
      it('should return all Azure defaults when override is undefined', () => {
        const result = mergeKongWithDefaults(undefined, 'azure');
        expect(result).toEqual({
          minInstances: KONG_DEFAULTS_AZURE.minInstances,
          maxInstances: KONG_DEFAULTS_AZURE.maxInstances,
          cpu: KONG_DEFAULTS_AZURE.cpu,
          memory: KONG_DEFAULTS_AZURE.memory,
        });
      });
    });

    describe('merges overrides with defaults', () => {
      it('should override all fields', () => {
        const result = mergeKongWithDefaults(
          {
            minInstances: 2,
            maxInstances: 8,
            cpu: '1',
            memory: '2Gi',
          },
          'azure',
        );
        expect(result).toEqual({
          minInstances: 2,
          maxInstances: 8,
          cpu: '1',
          memory: '2Gi',
        });
      });
    });
  });

  describe('provider-specific defaults differ', () => {
    it('should have different default memory for GCP vs AWS', () => {
      const gcpResult = mergeKongWithDefaults(undefined, 'gcp');
      const awsResult = mergeKongWithDefaults(undefined, 'aws');
      // AWS requires 2Gi minimum for 1 vCPU (Fargate constraint)
      expect(gcpResult.memory).toBe('1Gi'); // GCP Cloud Run
      expect(awsResult.memory).toBe('2Gi'); // AWS ECS Fargate
    });

    it('should have Azure-specific defaults', () => {
      const azureResult = mergeKongWithDefaults(undefined, 'azure');
      expect(azureResult.cpu).toBe('0.5'); // Azure Container Apps
      expect(azureResult.memory).toBe('1Gi');
      expect(azureResult.minInstances).toBe(1);
      expect(azureResult.maxInstances).toBe(5);
    });
  });
});
