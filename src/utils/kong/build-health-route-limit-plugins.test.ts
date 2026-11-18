import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';
import type { KongTemplate } from '@tsdevstack/cli/plugin';

rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { buildHealthRouteLimitPlugins } from './build-health-route-limit-plugins';

const GLOBAL_LIMIT = {
  name: 'rate-limiting',
  config: {
    minute: 100,
    policy: 'redis',
    redis: { host: '${REDIS_HOST}', port: 6379 },
  },
};

describe('buildHealthRouteLimitPlugins', () => {
  describe('Standard use cases', () => {
    it('should give the health route its own per-IP limit, counted without Redis', () => {
      const config: KongTemplate = { services: [], plugins: [GLOBAL_LIMIT] };

      expect(buildHealthRouteLimitPlugins(config)).toEqual([
        {
          name: 'rate-limiting',
          config: { minute: 600, limit_by: 'ip', policy: 'local' },
        },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should add nothing when the config has no global rate limit', () => {
      expect(
        buildHealthRouteLimitPlugins({
          services: [],
          plugins: [{ name: 'cors', config: {} }],
        }),
      ).toEqual([]);
      expect(buildHealthRouteLimitPlugins({ services: [] })).toEqual([]);
    });
  });
});
