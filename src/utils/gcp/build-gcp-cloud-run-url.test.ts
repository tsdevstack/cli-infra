import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { buildGcpCloudRunUrl } from './build-gcp-cloud-run-url';

describe('buildGcpCloudRunUrl', () => {
  describe('Standard use cases', () => {
    it('should build the fixed run.app URL', () => {
      expect(
        buildGcpCloudRunUrl(
          'myapp-auth-service',
          '123456789012',
          'europe-west1',
          'infra:deploy',
        ),
      ).toBe('https://myapp-auth-service-123456789012.europe-west1.run.app');
    });
  });

  describe('Edge cases', () => {
    it('should accept a label of exactly 63 characters', () => {
      // 50 + '-' + 12 = 63
      expect(() =>
        buildGcpCloudRunUrl('a'.repeat(50), '123456789012', 'us-central1', 'x'),
      ).not.toThrow();
    });

    it('should stop when the name and project number pass 63 characters', () => {
      expect(() =>
        buildGcpCloudRunUrl(
          'a'.repeat(51),
          '123456789012',
          'us-central1',
          'infra:deploy',
        ),
      ).toThrow('is 64 characters, over 63');
    });
  });
});
