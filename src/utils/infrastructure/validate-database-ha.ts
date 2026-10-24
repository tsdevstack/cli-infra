/**
 * Validate Database High Availability
 *
 * database.ha maps to Cloud SQL regional instances (GCP), Multi-AZ (AWS) and
 * a zone-redundant standby (Azure). Two combinations fail at the provider:
 * - Azure Burstable tiers (B_*) have no high availability.
 * - Cloud SQL requires automated backups and point-in-time recovery for it.
 * Whether an Azure region has availability zones is checked at deploy time
 * (preflight), since it needs the Azure API.
 */

import { getContext } from '../../context';
import { AZURE_BURSTABLE_DATABASE_TIER_PREFIX } from '../../constants';
import type { SchemaProvider } from './get-provider-schema-config';

/**
 * Validate database.ha against the resolved tier and backup settings
 *
 * @param environment - Environment name for error messages
 * @param database - Resolved database config (overrides merged with defaults)
 * @param provider - Cloud provider from config.json
 * @throws CliError if the provider cannot run the configured high availability
 */
export function validateDatabaseHa(
  environment: string,
  database: { tier: string; ha: boolean; backup: boolean },
  provider: SchemaProvider,
): void {
  const { CliError } = getContext();

  if (!database.ha) {
    return;
  }

  const field = `${environment}.database`;

  if (
    provider === 'azure' &&
    database.tier.startsWith(AZURE_BURSTABLE_DATABASE_TIER_PREFIX)
  ) {
    throw new CliError(
      `"database.ha" is not available on the Burstable tier "${database.tier}" (${field})`,
      'Infrastructure Config',
      'Azure offers high availability on General Purpose and Memory Optimized tiers only. ' +
        `Set "tier" to a GP_ or MO_ tier (e.g., "GP_Standard_D2s_v3") for ${field} in .tsdevstack/infrastructure.json, or set "ha" to false.`,
    );
  }

  if (provider === 'gcp' && !database.backup) {
    throw new CliError(
      `"database.ha" needs "database.backup" on GCP (${field})`,
      'Infrastructure Config',
      'Cloud SQL requires automated backups and point-in-time recovery for high availability. ' +
        `Set "backup" to true (or remove it) for ${field} in .tsdevstack/infrastructure.json, or set "ha" to false.`,
    );
  }
}
