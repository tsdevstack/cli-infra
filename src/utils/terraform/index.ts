/**
 * Shared Terraform utilities (provider-agnostic)
 */

export { escapeHcl } from './escape-hcl';
export { getTerraformErrors } from './get-terraform-errors';
export { logProviderUpgradeNextSteps } from './log-provider-upgrade-next-steps';
export { logPlanNextSteps } from './log-plan-next-steps';
export { planHasNoChanges } from './plan-has-no-changes';
export { initTerraformBeforeChanges } from './init-terraform-before-changes';
export {
  executeTerraform,
  getTerraformOutput,
  getTerraformOutputJson,
  toTerraformId,
  toTfVarSuffix,
} from '@tsdevstack/infra-core';
export type {
  TerraformCommand,
  TerraformExecuteOptions,
  TerraformResult,
} from '@tsdevstack/infra-core';
