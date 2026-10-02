/**
 * Resolve PostgreSQL Server Name (Azure)
 *
 * Single source of truth for the Azure PostgreSQL Flexible Server name.
 * Default: {project}-{environment}-postgres. An optional database.serverName
 * in infrastructure.json overrides it (the name is a global DNS name in Azure,
 * so the default can already be taken).
 */

import { getDatabaseConfig } from '../infrastructure/get-database-config';
import { validateDatabaseServerName } from '../infrastructure/validate-database-server-name';

export interface ResolvedPostgresServerName {
  /** Server name to use for Azure SDK calls and Terraform */
  name: string;
  /** True when database.serverName in infrastructure.json sets the name */
  isOverride: boolean;
}

/**
 * Resolve the PostgreSQL Flexible Server name for an environment
 *
 * @param projectName - Project name from config.json
 * @param targetEnv - Target environment (e.g., "dev")
 * @param infraConfig - Loaded infrastructure.json (null when the file is missing)
 * @returns The server name and whether it comes from an override
 * @throws CliError if the override breaks Azure naming rules
 */
export function resolvePostgresServerName(
  projectName: string,
  targetEnv: string,
  infraConfig: { [env: string]: unknown } | null,
): ResolvedPostgresServerName {
  const { serverName } = getDatabaseConfig(infraConfig, targetEnv, 'azure');

  if (serverName === undefined) {
    return { name: `${projectName}-${targetEnv}-postgres`, isOverride: false };
  }

  validateDatabaseServerName(targetEnv, serverName, 'azure');

  return { name: serverName, isOverride: true };
}
