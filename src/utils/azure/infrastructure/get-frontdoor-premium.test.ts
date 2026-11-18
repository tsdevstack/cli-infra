import { describe, it, expect } from '@rstest/core';
import { getFrontdoorPremium } from './get-frontdoor-premium';

describe('getFrontdoorPremium', () => {
  describe('Standard use cases', () => {
    it("should read the environment's frontdoorPremium", () => {
      const config = {
        prod: { frontdoorPremium: true },
        dev: { frontdoorPremium: false },
      };
      expect(getFrontdoorPremium(config, 'prod')).toBe(true);
      expect(getFrontdoorPremium(config, 'dev')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should be false without the setting, the environment or a config', () => {
      expect(getFrontdoorPremium({ prod: {} }, 'prod')).toBe(false);
      expect(getFrontdoorPremium({ prod: {} }, 'dev')).toBe(false);
      expect(getFrontdoorPremium({ prod: 'x' }, 'prod')).toBe(false);
      expect(getFrontdoorPremium(null, 'prod')).toBe(false);
    });
  });
});
