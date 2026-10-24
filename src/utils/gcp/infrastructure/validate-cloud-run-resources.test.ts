import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { validateCloudRunResources } from './validate-cloud-run-resources';

describe('validateCloudRunResources', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Defaults and common settings', () => {
    it('should accept the GCP service defaults (1 vCPU, 512Mi, concurrency 80)', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.api',
          { cpu: '1', memory: '512Mi', concurrency: 80 },
          'service',
        ),
      ).not.toThrow();
    });

    it('should accept the GCP Kong defaults (1 vCPU, 1Gi)', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.kong',
          { cpu: '1', memory: '1Gi' },
          'kong',
        ),
      ).not.toThrow();
    });

    it('should accept 8 vCPU with 8Gi', () => {
      expect(() =>
        validateCloudRunResources(
          'prod.api',
          { cpu: '8', memory: '8Gi', concurrency: 80 },
          'service',
        ),
      ).not.toThrow();
    });
  });

  describe('CPU below 1', () => {
    it('should require concurrency 1 for a service', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.api',
          { cpu: '0.5', memory: '512Mi', concurrency: 80 },
          'service',
        ),
      ).toThrow(
        'cpu "0.5" needs "concurrency": 1 on Cloud Run (dev.api has 80)',
      );
    });

    it('should accept a service with concurrency 1', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.api',
          { cpu: '0.25', memory: '256Mi', concurrency: 1 },
          'service',
        ),
      ).not.toThrow();
    });

    it('should reject it for a worker even with concurrency 1', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.auth-worker',
          { cpu: '0.5', memory: '512Mi', concurrency: 1 },
          'worker',
        ),
      ).toThrow('cpu "0.5" is not possible for a worker on Cloud Run');
    });

    it('should reject it for Kong', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.kong',
          { cpu: '0.5', memory: '1Gi' },
          'kong',
        ),
      ).toThrow('cpu "0.5" is not possible for Kong on Cloud Run');
    });
  });

  describe('Memory per CPU', () => {
    it('should reject more than 512 MiB below 0.5 vCPU', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.api',
          { cpu: '0.25', memory: '1Gi', concurrency: 1 },
          'service',
        ),
      ).toThrow('up to 512 MiB');
    });

    it('should reject more than 1 GiB below 1 vCPU', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.api',
          { cpu: '0.5', memory: '2Gi', concurrency: 1 },
          'service',
        ),
      ).toThrow('up to 1024 MiB');
    });

    it('should reject 8Gi with 1 vCPU', () => {
      expect(() =>
        validateCloudRunResources(
          'dev.api',
          { cpu: '1', memory: '8Gi', concurrency: 80 },
          'service',
        ),
      ).toThrow('memory "8Gi" is more than Cloud Run allows with cpu "1"');
    });

    it('should reject less than 2 GiB with 4 vCPU', () => {
      expect(() =>
        validateCloudRunResources(
          'prod.api',
          { cpu: '4', memory: '1Gi', concurrency: 80 },
          'service',
        ),
      ).toThrow('at least 2048 MiB');
    });

    it('should reject less than 4 GiB with 8 vCPU', () => {
      expect(() =>
        validateCloudRunResources(
          'prod.api',
          { cpu: '8', memory: '2Gi', concurrency: 80 },
          'service',
        ),
      ).toThrow('at least 4096 MiB');
    });
  });
});
