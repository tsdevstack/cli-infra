/**
 * AWS ECS utilities
 *
 * Re-exported from infra-core (wrappers removed in Phase 25e)
 */

export {
  updateEcsService,
  type UpdateEcsServiceOptions,
  type UpdateEcsServiceResult,
  waitForEcsStable,
  type WaitForEcsStableOptions,
  type WaitForEcsStableResult,
  executeEcsTask,
  type EcsTaskOptions,
  type EcsTaskResult,
  deleteEcsService,
  type DeleteEcsServiceOptions,
  type DeleteEcsServiceResult,
  deployEcsServiceWithSecrets,
  type DeployEcsServiceWithSecretsOptions,
  type DeployEcsServiceWithSecretsResult,
} from '@tsdevstack/infra-core';
