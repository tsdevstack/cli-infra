/**
 * Azure Command Types
 */

import type { AzureCredentials } from 'tsdevstack/plugin';

export interface AzureCommandContext {
  projectRoot: string;
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
  runningInCI: boolean;
}

export interface PlanOptions {
  /** Force unlock a stuck state lock before planning */
  forceUnlock?: boolean;
}

export interface DeployOptions {
  autoApprove?: boolean;
  /** Skip service deployment phases - only run infrastructure provisioning */
  infraOnly?: boolean;
  /** Image tag to deploy (defaults to current git SHA) */
  tag?: string;
  /** Force unlock a stuck state lock before deploying */
  forceUnlock?: boolean;
}

export interface DestroyOptions {
  autoApprove?: boolean;
}
