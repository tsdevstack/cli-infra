import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';
import type { KongTemplate } from '@tsdevstack/cli/plugin';

rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

import { buildUntracedPlugins } from './build-untraced-plugins';

const TRACING = {
  name: 'opentelemetry',
  config: {
    traces_endpoint: 'http://localhost:4318/v1/traces',
    sampling_rate: 1,
    resource_attributes: { 'service.name': 'kong' },
  },
};

describe('buildUntracedPlugins', () => {
  describe('Standard use cases', () => {
    it("should repeat the global tracing plugin's config at sampling rate 0", () => {
      const config: KongTemplate = { services: [], plugins: [TRACING] };

      expect(buildUntracedPlugins(config)).toEqual([
        {
          name: 'opentelemetry',
          config: {
            traces_endpoint: 'http://localhost:4318/v1/traces',
            sampling_rate: 0,
            resource_attributes: { 'service.name': 'kong' },
          },
        },
      ]);
    });

    it('should leave the global plugin as it is', () => {
      const config: KongTemplate = { services: [], plugins: [TRACING] };

      buildUntracedPlugins(config);

      expect(TRACING.config.sampling_rate).toBe(1);
    });
  });

  describe('Edge cases', () => {
    it('should add nothing without a tracing plugin', () => {
      expect(
        buildUntracedPlugins({
          services: [],
          plugins: [{ name: 'cors', config: {} }],
        }),
      ).toEqual([]);
      expect(buildUntracedPlugins({ services: [] })).toEqual([]);
    });
  });
});
