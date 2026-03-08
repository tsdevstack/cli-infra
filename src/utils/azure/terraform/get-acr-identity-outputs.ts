/**
 * Get ACR Identity Outputs
 *
 * Reads managed identity resource ID and client ID from Terraform outputs.
 * Returns undefined values when outputs don't exist (old Terraform state
 * before managed identity was provisioned).
 */

import { getTerraformOutput } from '../../terraform';

export interface AcrIdentityOutputs {
  acrManagedIdentityId?: string;
  managedIdentityClientId?: string;
}

export function getAcrIdentityOutputs(
  terraformDir: string,
  tfEnv: Record<string, string>,
): AcrIdentityOutputs {
  let acrManagedIdentityId: string | undefined;
  let managedIdentityClientId: string | undefined;

  try {
    acrManagedIdentityId = getTerraformOutput(
      terraformDir,
      'container_apps_acr_identity_id',
      tfEnv,
    );
  } catch {
    // Old Terraform state — fall back to password-based auth
  }

  try {
    managedIdentityClientId = getTerraformOutput(
      terraformDir,
      'container_apps_acr_identity_client_id',
      tfEnv,
    );
  } catch {
    // Old Terraform state — fall back to SP credentials
  }

  return { acrManagedIdentityId, managedIdentityClientId };
}
