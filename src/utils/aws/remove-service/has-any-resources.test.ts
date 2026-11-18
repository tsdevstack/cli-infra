/**
 * Tests for has-any-resources
 */

import { describe, it, expect } from '@rstest/core';
import { hasAnyResources } from './has-any-resources';
import type { DiscoveredResources } from '../discovery';

describe('hasAnyResources', () => {
  describe('Standard use cases', () => {
    it('should return false when no resources exist', () => {
      const discovered: DiscoveredResources = {
        ecsService: false,

        spaBucket: false,
        spaBucketName: '',
        cloudFrontDistributions: [],
        secrets: [],
        inferredType: 'unknown',
      };

      expect(hasAnyResources(discovered)).toBe(false);
    });

    it('should return true when only a CloudFront distribution is left', () => {
      // A rerun after the bucket was deleted: the distribution still needs deleting
      const discovered: DiscoveredResources = {
        ecsService: false,
        spaBucket: false,
        spaBucketName: '',
        cloudFrontDistributions: [{ id: 'E2SPA123', kind: 'spa' }],
        secrets: [],
        inferredType: 'unknown',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when only the origin access control is left', () => {
      const discovered: DiscoveredResources = {
        ecsService: false,
        spaBucket: false,
        spaBucketName: '',
        cloudFrontDistributions: [],
        spaOriginAccessControlId: 'OAC123',
        secrets: [],
        inferredType: 'unknown',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when ECS service exists', () => {
      const discovered: DiscoveredResources = {
        ecsService: true,

        spaBucket: false,
        spaBucketName: '',
        cloudFrontDistributions: [],
        secrets: [],
        inferredType: 'backend',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when SPA bucket exists', () => {
      const discovered: DiscoveredResources = {
        ecsService: false,

        spaBucket: true,
        spaBucketName: 'my-spa-bucket',
        cloudFrontDistributions: [],
        secrets: [],
        inferredType: 'spa',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when secrets exist', () => {
      const discovered: DiscoveredResources = {
        ecsService: false,

        spaBucket: false,
        spaBucketName: '',
        cloudFrontDistributions: [],
        secrets: ['secret1', 'secret2'],
        inferredType: 'unknown',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when multiple resources exist', () => {
      const discovered: DiscoveredResources = {
        ecsService: true,

        spaBucket: true,
        spaBucketName: 'my-spa-bucket',
        cloudFrontDistributions: [],
        secrets: ['secret1'],
        inferredType: 'backend',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });
  });
});
