/**
 * Shared Terraform utilities (provider-agnostic)
 */

export { escapeHcl } from './escape-hcl';
export { toTfVarSuffix } from './to-tf-var-suffix';
export { toTerraformId } from './to-terraform-id';
export { getTerraformErrors } from './get-terraform-errors';
export {
  executeTerraform,
  getTerraformOutput,
  getTerraformOutputJson,
} from '@tsdevstack/infra-core';
export type {
  TerraformCommand,
  TerraformExecuteOptions,
  TerraformResult,
} from '@tsdevstack/infra-core';
