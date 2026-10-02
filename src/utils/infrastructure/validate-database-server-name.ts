/**
 * Validate Database Server Name
 *
 * Validates the optional database.serverName override in infrastructure.json.
 * Only Azure supports it: the PostgreSQL Flexible Server name is a global DNS
 * name there, so the default {project}-{environment}-postgres can already be
 * taken (for example by a server in a deleted subscription).
 */

import { getContext } from '../../context';
import { AZURE_POSTGRES_SERVER_NAME_CONSTRAINTS } from '../../constants';
import type { SchemaProvider } from './get-provider-schema-config';

/**
 * Validate database.serverName for an environment
 *
 * @param environment - Environment name for error messages
 * @param serverName - Raw serverName value from infrastructure.json (undefined = not set)
 * @param provider - Cloud provider from config.json
 * @throws CliError if the field is set on a provider other than Azure or breaks Azure naming rules
 */
export function validateDatabaseServerName(
  environment: string,
  serverName: unknown,
  provider: SchemaProvider,
): void {
  const { CliError } = getContext();

  if (serverName === undefined) {
    return;
  }

  const field = `${environment}.database.serverName`;
  const { minLength, maxLength, pattern } =
    AZURE_POSTGRES_SERVER_NAME_CONSTRAINTS;
  const namingHint =
    `Use ${minLength} to ${maxLength} lowercase letters, digits and hyphens, ` +
    'not starting or ending with a hyphen (e.g., "myapp-dev-postgres-2").';

  if (provider !== 'azure') {
    throw new CliError(
      `"database.serverName" is not supported on ${provider.toUpperCase()} (${field})`,
      'Infrastructure Config',
      'The server name override is Azure only. ' +
        `Remove "serverName" from ${environment}.database in .tsdevstack/infrastructure.json.`,
    );
  }

  if (typeof serverName !== 'string') {
    throw new CliError(
      `"database.serverName" must be a string (${field})`,
      'Infrastructure Config',
      namingHint,
    );
  }

  if (serverName.length < minLength || serverName.length > maxLength) {
    throw new CliError(
      `"database.serverName" must be ${minLength} to ${maxLength} characters, got ${serverName.length} (${field})`,
      'Infrastructure Config',
      namingHint,
    );
  }

  if (!new RegExp(pattern).test(serverName)) {
    throw new CliError(
      `"database.serverName" "${serverName}" is not a valid Azure PostgreSQL server name (${field})`,
      'Infrastructure Config',
      namingHint,
    );
  }
}
