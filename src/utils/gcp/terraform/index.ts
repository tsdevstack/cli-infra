/**
 * GCP Terraform utilities
 *
 * GCP-specific: toDnsAuthName
 * Provider-agnostic utilities re-exported from utils/terraform/
 */

export { toDnsAuthName } from './to-dns-auth-name';

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
