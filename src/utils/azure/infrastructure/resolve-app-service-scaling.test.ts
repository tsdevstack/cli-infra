import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { resolveAppServiceScaling } from './resolve-app-service-scaling';

describe('resolveAppServiceScaling', () => {
  describe('Basic SKUs (fixed count)', () => {
    it('should run minInstances and drop the ceiling', () => {
      expect(resolveAppServiceScaling('B1', 2, 5)).toEqual({
        instances: 2,
        autoscaleMax: null,
      });
    });

    it('should run at least one instance', () => {
      expect(resolveAppServiceScaling('B1', 0, 5)).toEqual({
        instances: 1,
        autoscaleMax: null,
      });
    });
  });

  describe('Standard and Premium SKUs (CPU autoscale)', () => {
    it('should autoscale between minInstances and maxInstances', () => {
      expect(resolveAppServiceScaling('S1', 1, 5)).toEqual({
        instances: 1,
        autoscaleMax: 5,
      });
      expect(resolveAppServiceScaling('P1v3', 2, 10)).toEqual({
        instances: 2,
        autoscaleMax: 10,
      });
    });

    it('should not autoscale when the ceiling is not above the count', () => {
      expect(resolveAppServiceScaling('S1', 2, 2)).toEqual({
        instances: 2,
        autoscaleMax: null,
      });
      expect(resolveAppServiceScaling('S1', 3, 2)).toEqual({
        instances: 3,
        autoscaleMax: null,
      });
    });

    it('should count from one when minInstances is 0', () => {
      expect(resolveAppServiceScaling('S1', 0, 3)).toEqual({
        instances: 1,
        autoscaleMax: 3,
      });
    });
  });
});
