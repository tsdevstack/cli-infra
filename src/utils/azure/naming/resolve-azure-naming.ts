/**
 * Resolve an Azure environment's naming, for the name builders
 */

import type { AzureCredentials, AzureNaming } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

/**
 * The environment's naming scheme (cli-core's resolveAzureNamingScheme: is
 * the shared Key Vault under its old name?) with the subscription ID, which
 * the unique scheme's suffix comes from. Checked once per command.
 *
 * @param credentials - The environment's Azure credentials
 * @param projectName - Project name from config.json
 * @param env - Environment
 * @returns The scheme and subscription ID
 */
export async function resolveAzureNaming(
  credentials: AzureCredentials,
  projectName: string,
  env: string,
): Promise<AzureNaming> {
  const { resolveAzureNamingScheme } = getContext();
  return {
    scheme: await resolveAzureNamingScheme(credentials, projectName, env),
    subscriptionId: credentials.subscriptionId,
  };
}
