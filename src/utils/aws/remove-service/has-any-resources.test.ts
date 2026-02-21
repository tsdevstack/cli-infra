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
        appRunnerService: false,
        spaBucket: false,
        spaBucketName: '',
        secrets: [],
        inferredType: 'unknown',
      };

      expect(hasAnyResources(discovered)).toBe(false);
    });

    it('should return true when ECS service exists', () => {
      const discovered: DiscoveredResources = {
        ecsService: true,
        appRunnerService: false,
        spaBucket: false,
        spaBucketName: '',
        secrets: [],
        inferredType: 'backend',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when App Runner service exists', () => {
      const discovered: DiscoveredResources = {
        ecsService: false,
        appRunnerService: true,
        spaBucket: false,
        spaBucketName: '',
        secrets: [],
        inferredType: 'nextjs',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when SPA bucket exists', () => {
      const discovered: DiscoveredResources = {
        ecsService: false,
        appRunnerService: false,
        spaBucket: true,
        spaBucketName: 'my-spa-bucket',
        secrets: [],
        inferredType: 'spa',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when secrets exist', () => {
      const discovered: DiscoveredResources = {
        ecsService: false,
        appRunnerService: false,
        spaBucket: false,
        spaBucketName: '',
        secrets: ['secret1', 'secret2'],
        inferredType: 'unknown',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });

    it('should return true when multiple resources exist', () => {
      const discovered: DiscoveredResources = {
        ecsService: true,
        appRunnerService: false,
        spaBucket: true,
        spaBucketName: 'my-spa-bucket',
        secrets: ['secret1'],
        inferredType: 'backend',
      };

      expect(hasAnyResources(discovered)).toBe(true);
    });
  });
});
