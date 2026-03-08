/**
 * Command setup utilities
 *
 * Shared setup helpers for infrastructure commands.
 */

export {
  setupInfraCommand,
  type InfraCommandContext,
} from './setup-infra-command';
export { setupGCPInfraCommand } from '../gcp/setup/setup-gcp-infra-command';
