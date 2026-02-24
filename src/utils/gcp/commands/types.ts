/**
 * GCP Command Types
 */

import type { GCPCredentials } from '@tsdevstack/cli/plugin';

export interface GCPCommandContext {
  projectRoot: string;
  projectName: string;
  targetEnv: string;
  credentials: GCPCredentials;
  runningInCI: boolean;
}

export interface DeployOptions {
  autoApprove?: boolean;
  /** Skip service deployment phases (Docker, Kong, LB) - only run infrastructure provisioning */
  infraOnly?: boolean;
  /** Image tag to deploy (defaults to current git SHA) */
  tag?: string;
}

export interface DestroyOptions {
  autoApprove?: boolean;
}
