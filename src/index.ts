/**
 * cli-infra - Infrastructure Deployment Plugin for tsdevstack CLI
 *
 * This package provides infrastructure deployment commands for GCP Cloud Run.
 * It is loaded by cli-core as a bundled plugin.
 *
 * Usage in cli.ts:
 *   import { initContext, registerInfraPlugin } from '@tsdevstack/cli-infra';
 *   initContext(pluginContext);
 *   registerInfraPlugin(program);
 */

// Context initialization - must be called before registerInfraPlugin
export { initContext } from './context';

// Command registration
export { registerInfraPlugin } from './register-commands';

// Infrastructure config utilities (for potential reuse)
export { loadInfrastructureConfig } from './utils/infrastructure/load-infrastructure-config';
export { validateInfrastructureConfig } from './utils/infrastructure/validate-infrastructure-config';
export {
  mergeWithDefaults,
  getServiceConfig,
} from './utils/infrastructure/merge-with-defaults';
export type {
  InfrastructureConfig,
  ServiceOverride,
  ResolvedServiceConfig,
} from './utils/infrastructure/types';

// Constants
export {
  INFRASTRUCTURE_DEFAULTS_GCP,
  INFRASTRUCTURE_DEFAULTS_AWS,
  VALID_CPU_VALUES,
  VALID_MEMORY_VALUES,
  SUPPORTED_VERSIONS,
} from './constants';
