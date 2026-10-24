/**
 * Azure App Service plan tiers (Kong and Next.js plans)
 */

/**
 * What each App Service tier can do, by SKU prefix (B1-B3, S1-S3, P1v3-P3v3):
 * the most instances a plan can run, and whether Azure Monitor autoscale can
 * drive the count. A Basic plan runs a fixed count (minInstances); autoscale
 * between minInstances and maxInstances needs Standard or higher (App
 * Service limits, "Scale out" and "Autoscale").
 */
export const APP_SERVICE_TIERS = {
  B: { name: 'Basic', maxInstances: 3, autoscale: false },
  S: { name: 'Standard', maxInstances: 10, autoscale: true },
  P: { name: 'Premium', maxInstances: 30, autoscale: true },
} as const;
