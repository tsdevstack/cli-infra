/**
 * Shared Terraform utilities (provider-agnostic)
 */

export { escapeHcl } from './escape-hcl';
export { toTfVarSuffix } from './to-tf-var-suffix';
export { toTerraformId } from './to-terraform-id';
export { getTerraformErrors } from './get-terraform-errors';
export { logProviderUpgradeNextSteps } from './log-provider-upgrade-next-steps';
export { logPlanNextSteps } from './log-plan-next-steps';
export { planHasNoChanges } from './plan-has-no-changes';
export { initTerraformBeforeChanges } from './init-terraform-before-changes';
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
