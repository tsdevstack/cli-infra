/**
 * Azure Terraform utilities
 *
 * Provider-agnostic utilities re-exported from utils/terraform/
 */

// Re-export provider-agnostic terraform utilities
export {
  executeTerraform,
  getTerraformOutput,
  getTerraformOutputJson,
} from '../../terraform';

export type {
  TerraformCommand,
  TerraformExecuteOptions,
  TerraformResult,
} from '../../terraform';

// Azure-specific terraform utilities
export { getAcrIdentityOutputs } from './get-acr-identity-outputs';
export type { AcrIdentityOutputs } from './get-acr-identity-outputs';
export { getServiceSecretsIdentities } from './get-service-secrets-identities';
export type { ServiceSecretsIdentity } from './get-service-secrets-identities';
