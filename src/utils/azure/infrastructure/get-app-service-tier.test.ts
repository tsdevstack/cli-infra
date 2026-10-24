import { describe, it, expect, rs } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { getAppServiceTier } from './get-app-service-tier';

describe('getAppServiceTier', () => {
  describe('Standard use cases', () => {
    it('should resolve Basic SKUs to a fixed count of at most 3', () => {
      for (const sku of ['B1', 'B2', 'B3']) {
        expect(getAppServiceTier(sku)).toEqual({
          name: 'Basic',
          maxInstances: 3,
          autoscale: false,
        });
      }
    });

    it('should resolve Standard SKUs to autoscale up to 10', () => {
      expect(getAppServiceTier('S1')).toEqual({
        name: 'Standard',
        maxInstances: 10,
        autoscale: true,
      });
    });

    it('should resolve Premium SKUs to autoscale up to 30', () => {
      expect(getAppServiceTier('P2v3')).toEqual({
        name: 'Premium',
        maxInstances: 30,
        autoscale: true,
      });
    });
  });

  describe('Edge cases', () => {
    it('should reject a SKU the framework does not know', () => {
      expect(() => getAppServiceTier('P1v2')).toThrow(mocks.CliError);
      expect(() => getAppServiceTier('X1')).toThrow(
        'Unknown App Service SKU "X1"',
      );
    });
  });
});
