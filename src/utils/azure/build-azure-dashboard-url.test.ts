import { describe, it, expect } from '@rstest/core';
import { buildAzureDashboardUrl } from './build-azure-dashboard-url';

describe('buildAzureDashboardUrl', () => {
  describe('Standard use cases', () => {
    it('should open the workbook in the portal', () => {
      expect(
        buildAzureDashboardUrl(
          '/subscriptions/sub-1/resourceGroups/shop-dev-rg/providers/Microsoft.Insights/workbooks/0f8f-guid',
        ),
      ).toBe(
        'https://portal.azure.com/#resource/subscriptions/sub-1/resourceGroups/shop-dev-rg/providers/Microsoft.Insights/workbooks/0f8f-guid/workbook',
      );
    });
  });
});
