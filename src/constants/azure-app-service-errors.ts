/**
 * Azure App Service plan errors the deploy explains instead of retrying
 *
 * Every App Service plan create that fails counts toward an Azure limit:
 * after too many creates or failed creates in a short time, Azure refuses
 * further plan creates for the subscription in that region (429, extended
 * code 51025). Azure documents no duration; Microsoft's answers on its Q&A
 * site say up to 48 hours (az5, 2026-11-18). So a shortage of App Service
 * machines is not retried (it was, 2026-11-17): the deploy stops at once
 * with these hints. Checked in order, the limit first.
 */
export const AZURE_APP_SERVICE_PLAN_ERRORS: readonly {
  pattern: RegExp;
  hint: string;
}[] = [
  {
    pattern: /App Service Plan \w+ operation is throttled|"51025"/,
    hint:
      'Azure is refusing App Service plan creates for this subscription in this region after too many creates or failed creates (code 51025). ' +
      "Every new attempt counts, so don't run infra:deploy again now. " +
      'Ask Azure support to lift the limit (give the subscription, the region, code 51025 and the time), or wait: Azure documents no duration, its support answers mention up to 48 hours. ' +
      'Everything created so far stays in place; the next deploy continues where this one stopped.',
  },
  {
    pattern: /No available instances to satisfy this request/i,
    hint:
      'App Service has no free machines of this size in the region right now (not a quota error). ' +
      'Choose another size (appService.kongSku or appService.nextjsSku in .tsdevstack/infrastructure.json, for example B2), then run infra:deploy again. ' +
      'Avoid running it again with the same size: every failed plan create counts toward an Azure limit that then blocks plan creates for the subscription.',
  },
];
