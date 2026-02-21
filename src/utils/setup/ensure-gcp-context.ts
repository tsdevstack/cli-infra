/**
 * Ensure GCP Context
 *
 * Type guard to ensure the InfraCommandContext is for GCP provider.
 * Throws an error if the provider is not GCP.
 */

import { getContext } from '../../context';
import type { InfraCommandContext } from './setup-infra-command';
import type { GCPCommandContext } from '../gcp/commands/types';

/**
 * Ensures the context is for GCP and returns a properly typed GCPCommandContext.
 * Throws CliError if the provider is not GCP.
 */
export function ensureGCPContext(
  ctx: InfraCommandContext,
  commandName: string,
): GCPCommandContext {
  const { CliError } = getContext();

  if (ctx.provider !== 'gcp') {
    throw new CliError(
      `Command '${commandName}' is only available for GCP`,
      commandName,
      'This command does not yet support AWS',
    );
  }

  return ctx as GCPCommandContext;
}
