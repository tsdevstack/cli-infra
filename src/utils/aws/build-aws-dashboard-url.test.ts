import { describe, it, expect } from '@rstest/core';
import { buildAwsDashboardUrl } from './build-aws-dashboard-url';

describe('buildAwsDashboardUrl', () => {
  describe('Standard use cases', () => {
    it("should link to the dashboard in the region's console", () => {
      expect(buildAwsDashboardUrl('shop-dev', 'eu-west-1')).toBe(
        'https://eu-west-1.console.aws.amazon.com/cloudwatch/home?region=eu-west-1#dashboards/dashboard/shop-dev',
      );
    });
  });

  describe('Edge cases', () => {
    it('should escape the name', () => {
      expect(buildAwsDashboardUrl('a b', 'us-east-1')).toContain(
        '#dashboards/dashboard/a%20b',
      );
    });
  });
});
