import { describe, it, expect } from '@rstest/core';
import { buildGcpDashboardUrl } from './build-gcp-dashboard-url';

describe('buildGcpDashboardUrl', () => {
  describe('Standard use cases', () => {
    it("should link to the dashboard in the project's console", () => {
      expect(buildGcpDashboardUrl('1a2b3c', 'shop-dev')).toBe(
        'https://console.cloud.google.com/monitoring/dashboards/builder/1a2b3c?project=shop-dev',
      );
    });
  });

  describe('Edge cases', () => {
    it('should escape what does not belong in a URL', () => {
      expect(buildGcpDashboardUrl('a/b', 'p q')).toBe(
        'https://console.cloud.google.com/monitoring/dashboards/builder/a%2Fb?project=p%20q',
      );
    });
  });
});
