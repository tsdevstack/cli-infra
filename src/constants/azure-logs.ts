/**
 * Azure constants for infra:logs (Log Analytics)
 */

/** Resource group of an environment: `{project}-{env}-rg` */
export const AZURE_RESOURCE_GROUP_SUFFIX = '-rg';

/** Log Analytics workspace of an environment: `{project}-{env}-logs` */
export const AZURE_LOG_WORKSPACE_SUFFIX = '-logs';

/**
 * Reads go slice by slice, so lines come out as they arrive and no query
 * reaches Log Analytics' 500,000-row limit
 */
export const AZURE_LOGS_SLICE_MINUTES = 15;

/** Front Door's request and WAF logs (in the AzureDiagnostics table) */
export const AZURE_FRONT_DOOR_LOG_CATEGORIES = [
  'FrontDoorAccessLog',
  'FrontDoorWebApplicationFirewallLog',
] as const;
