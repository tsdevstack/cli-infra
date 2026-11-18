/**
 * Database lock types (Azure)
 */

import type { AzureCredentials } from '@tsdevstack/cli/plugin';

/** The PostgreSQL Flexible Server whose delete lock the CLI manages */
export interface DatabaseLockTarget {
  credentials: AzureCredentials;
  resourceGroupName: string;
  serverName: string;
}
