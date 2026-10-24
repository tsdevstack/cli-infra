/**
 * Validate Database Disk Size
 *
 * Validates database.diskSize in infrastructure.json against what the
 * provider can create: Cloud SQL from 10 GB, RDS gp3 from 20 GB, and Azure
 * Flexible Server only in fixed sizes (32, 64, 128, 256, 512 GB up to the
 * 1000 GB cap). A size outside these fails late, in Terraform.
 */

import { getContext } from '../../context';
import {
  getProviderSchemaConfig,
  type SchemaProvider,
} from './get-provider-schema-config';

/**
 * Validate database.diskSize for an environment
 *
 * @param environment - Environment name for error messages
 * @param diskSize - Raw or resolved diskSize value (undefined = not set)
 * @param provider - Cloud provider from config.json
 * @throws CliError if the size is not a whole number the provider supports
 */
export function validateDatabaseDiskSize(
  environment: string,
  diskSize: unknown,
  provider: SchemaProvider,
): void {
  const { CliError } = getContext();

  if (diskSize === undefined) {
    return;
  }

  const field = `${environment}.database.diskSize`;
  const { min, max, allowed } =
    getProviderSchemaConfig(provider).databaseDiskSize;
  const sizesHint = allowed
    ? `${provider.toUpperCase()} supports these sizes (GB): ${allowed.join(', ')}.`
    : `${provider.toUpperCase()} supports ${min} to ${max} GB.`;
  const hint = `${sizesHint} Set "diskSize" for ${environment}.database in .tsdevstack/infrastructure.json (or remove it to use the default).`;

  if (typeof diskSize !== 'number' || !Number.isInteger(diskSize)) {
    throw new CliError(
      `"database.diskSize" must be a whole number of GB (${field})`,
      'Infrastructure Config',
      hint,
    );
  }

  const supported = allowed
    ? allowed.includes(diskSize)
    : diskSize >= min && diskSize <= max;

  if (!supported) {
    throw new CliError(
      `"database.diskSize" ${diskSize} is not supported on ${provider.toUpperCase()} (${field})`,
      'Infrastructure Config',
      hint,
    );
  }
}
