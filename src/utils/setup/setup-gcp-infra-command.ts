/**
 * Setup GCP Infrastructure Command
 *
 * Wrapper around setupInfraCommand that ensures GCP provider
 * and returns a properly typed GCPCommandContext.
 */

import { getContext } from '../../context';
import { setupInfraCommand } from './setup-infra-command';
import type { GCPCommandContext } from '../gcp/commands/types';

interface CommandOptions {
  env?: string;
}

/**
 * Set up infrastructure command context for GCP-only commands.
 * Throws an error if the provider is not GCP.
 */
export async function setupGCPInfraCommand(
  options: CommandOptions,
  commandName: string,
): Promise<GCPCommandContext> {
  const { CliError } = getContext();

  const ctx = await setupInfraCommand(options, commandName);

  if (ctx.provider !== 'gcp') {
    throw new CliError(
      `Command '${commandName}' is only available for GCP`,
      commandName,
      'This command does not yet support AWS',
    );
  }

  return ctx as GCPCommandContext;
}
