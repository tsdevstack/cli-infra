import { describe, it, expect } from '@rstest/core';
import { buildGcpServiceLabels } from './build-gcp-service-labels';

describe('buildGcpServiceLabels', () => {
  describe('Standard use cases', () => {
    it('should mark the project in the unique scheme', () => {
      expect(buildGcpServiceLabels('shop', 'unique')).toEqual({
        'tsdevstack-project': 'shop',
      });
    });

    it('should add no labels in a legacy environment', () => {
      expect(buildGcpServiceLabels('shop', 'legacy')).toBeUndefined();
    });
  });
});
