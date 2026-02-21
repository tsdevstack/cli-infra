/**
 * Unified Discovery Types
 *
 * Shared type definitions for deployed service discovery across all
 * cloud providers (GCP, AWS, Azure). Each provider's discovery function
 * returns these types, ensuring consistent interfaces for consumers
 * like checkTopologyDrift and list-deployed commands.
 *
 * Provider-specific resource fields are optional — only the originating
 * provider sets them. Common fields (hasDatabase, secretCount) are also
 * optional because not all providers can discover this information
 * (e.g. AWS discovery doesn't check for RDS associations).
 */

/** Service type as inferred from cloud discovery */
export type DeployedServiceType =
  | 'backend'
  | 'nextjs'
  | 'worker'
  | 'kong'
  | 'spa'
  | 'unknown';

export interface DeployedServiceInfo {
  name: string;
  type: DeployedServiceType;
  status: string;
  url?: string;
  imageUri?: string;
  resources: {
    /** All providers set this */
    spaBucket: boolean;

    /**
     * Whether the service has an associated database.
     * Optional — not all providers discover this (AWS doesn't).
     * When undefined, checkTopologyDrift falls back to type-based filtering.
     */
    hasDatabase?: boolean;

    /** Number of secrets associated with the service. Optional. */
    secretCount?: number;

    // GCP-specific
    cloudRunService?: boolean;
    hasServiceAccount?: boolean;

    // AWS-specific
    ecsService?: boolean;
    appRunnerService?: boolean;
    runningCount?: number;
    desiredCount?: number;

    // Azure-specific
    containerApp?: boolean;
    appService?: boolean;
  };
}

export interface DiscoverDeployedServicesResult {
  success: boolean;
  services: DeployedServiceInfo[];
  error?: string;
}
