/**
 * Whether an environment uses Front Door Premium
 */

/**
 * Premium connects Front Door to App Service over Private Link and turns
 * off the apps' public access after the deploy, Kudu included.
 *
 * @param config - The raw infrastructure.json, or null without one
 * @param env - The environment
 * @returns The environment's `frontdoorPremium`, false when not set
 */
export function getFrontdoorPremium(
  config: { [env: string]: unknown } | null,
  env: string,
): boolean {
  if (!config) return false;
  const envConfig = config[env];
  if (!envConfig || typeof envConfig !== 'object') return false;
  return (
    (envConfig as { frontdoorPremium?: boolean }).frontdoorPremium ?? false
  );
}
