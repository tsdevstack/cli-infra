/**
 * Azure Container Apps utilities
 *
 * Re-exported from infra-core (wrappers removed in Phase 25e)
 */

export {
  createOrUpdateContainerApp,
  type CreateOrUpdateContainerAppOptions,
  type CreateOrUpdateContainerAppResult,
  waitForContainerAppReady,
  type WaitForContainerAppReadyOptions,
  type WaitForContainerAppReadyResult,
} from '@tsdevstack/infra-core';
