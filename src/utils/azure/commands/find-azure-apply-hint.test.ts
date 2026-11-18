import { describe, it, expect } from '@rstest/core';
import { findAzureApplyHint } from './find-azure-apply-hint';

// az5, 2026-11-18
const PLAN_CREATE_LIMIT = `╷
│ Error: creating App Service Plan (Subscription: "x"
│ Resource Group Name: "rg"
│ Server Farm Name: "app-dev-kong-plan"): performing CreateOrUpdate: unexpected status 429 (429 Too Many Requests) with response: {"Code":"429","Message":"App Service Plan Create operation is throttled for subscription x. Please contact support if issue persists.","Target":null,"Details":[{"Message":"App Service Plan Create operation is throttled for subscription x. Please contact support if issue persists."},{"Code":"429"},{"ErrorEntity":{"ExtendedCode":"51025","MessageTemplate":"App Service Plan {0} operation is throttled for subscription {1}. Please contact support if issue persists.","Parameters":["Create","x"],"Code":"429"}}],"Innererror":null}
│
│   with azurerm_service_plan.kong,
╵`;

// az5, 2026-11-17
const PLAN_SHORTAGE = `╷
│ Error: creating App Service Plan (Subscription: "x"
│ Resource Group Name: "rg"
│ Server Farm Name: "app-dev-kong-plan"): performing CreateOrUpdate: unexpected status 409 (409 Conflict) with response: {"Code":"Conflict","Message":"No available instances to satisfy this request. App Service is attempting to increase capacity. Please retry your request later or consider enabling Async Scaling on your app service plan: aka.ms/async-scaling.","Target":null,"Details":[{"ErrorEntity":{"ExtendedCode":"03029"}}],"Innererror":null}
│
│   with azurerm_service_plan.kong,
╵`;

describe('findAzureApplyHint', () => {
  describe('Standard use cases', () => {
    it('should say not to run the deploy again while Azure limits plan creates', () => {
      const hint = findAzureApplyHint(PLAN_CREATE_LIMIT);

      expect(hint).toContain('code 51025');
      expect(hint).toContain("don't run infra:deploy again now");
    });

    it('should point to another size when App Service is short of machines', () => {
      const hint = findAzureApplyHint(PLAN_SHORTAGE);

      expect(hint).toContain('appService.kongSku or appService.nextjsSku');
      expect(hint).toContain('Avoid running it again with the same size');
    });
  });

  describe('Edge cases', () => {
    it('should name the limit when both errors are in the output', () => {
      expect(
        findAzureApplyHint(`${PLAN_SHORTAGE}\n${PLAN_CREATE_LIMIT}`),
      ).toContain('code 51025');
    });

    it('should give no hint for other errors', () => {
      expect(
        findAzureApplyHint(
          '│ Error: creating Flexible Server: Status: "SkuNotAvailable"',
        ),
      ).toBeUndefined();
      expect(findAzureApplyHint('')).toBeUndefined();
    });
  });
});
