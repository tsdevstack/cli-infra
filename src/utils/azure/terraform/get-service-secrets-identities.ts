/**
 * Get each backend service's Key Vault identity from Terraform outputs
 */

import { getContext } from '../../../context';
import { getTerraformOutputJson } from '../../terraform';

/** A service's Key Vault identity */
export interface ServiceSecretsIdentity {
  /** Resource ID, attached to the service's Container Apps */
  id: string;
  /** Client ID, passed as AZURE_SECRETS_CLIENT_ID */
  client_id: string;
}

/**
 * Read the `service_secrets_identities` output: one identity per backend
 * service, with access to the shared vault and that service's own vault.
 * There is no fallback: without its identity a service could not read its
 * secrets, and the deploy credentials must never stand in for it.
 *
 * @param terraformDir - Terraform working directory of the environment
 * @param tfEnv - Environment variables for Terraform
 * @returns Service name → identity
 * @throws CliError when the output does not exist yet
 */
export function getServiceSecretsIdentities(
  terraformDir: string,
  tfEnv: Record<string, string>,
): Record<string, ServiceSecretsIdentity> {
  const { CliError } = getContext();

  try {
    return getTerraformOutputJson<Record<string, ServiceSecretsIdentity>>(
      terraformDir,
      'service_secrets_identities',
      tfEnv,
    );
  } catch {
    throw new CliError(
      "The services' Key Vault identities are missing from the Terraform outputs",
      'infra:deploy',
      'Run npx tsdevstack infra:deploy for this environment to create them',
    );
  }
}
