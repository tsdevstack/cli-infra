/**
 * Detect an environment's naming scheme from its Terraform state
 */

import {
  NAMING_SCHEMES,
  NAMING_SCHEME_OUTPUT,
  type NamingScheme,
} from '@tsdevstack/infra-core';
import { getContext } from '../../context';

/**
 * Which names an environment uses, from its Terraform state:
 *
 * - The state records the scheme (`naming_scheme` output): that scheme.
 *   Every apply with this CLI writes it.
 * - The state holds resources but no scheme: the environment was deployed
 *   before the scheme existed, so it keeps the names it has (legacy).
 * - No state, or a state without resources: nothing is deployed, so the
 *   environment starts with unique names.
 *
 * A state that can't be read as Terraform state stops the command: guessing
 * could rename (recreate) a deployed environment's resources.
 *
 * @param state - The parsed state file, or undefined when there is none
 * @param commandName - Command name for the error
 * @returns The environment's naming scheme
 */
export function detectNamingScheme(
  state: unknown,
  commandName: string,
): NamingScheme {
  const { CliError } = getContext();

  if (state === undefined) {
    return 'unique';
  }

  if (typeof state !== 'object' || state === null) {
    throw new CliError(
      'The Terraform state is not a JSON object',
      commandName,
      'The CLI reads the state to keep the names this environment was deployed with. Check the state file in the state bucket.',
    );
  }

  const { outputs, resources } = state as {
    outputs?: Record<string, { value?: unknown } | undefined>;
    resources?: unknown;
  };

  const recorded = outputs?.[NAMING_SCHEME_OUTPUT]?.value;
  if (recorded !== undefined) {
    if ((NAMING_SCHEMES as readonly unknown[]).includes(recorded)) {
      return recorded as NamingScheme;
    }
    throw new CliError(
      `The Terraform state records an unknown naming scheme: ${JSON.stringify(recorded)}`,
      commandName,
      `Known schemes: ${NAMING_SCHEMES.join(', ')}. A newer CLI may have deployed this environment: update @tsdevstack/cli.`,
    );
  }

  return Array.isArray(resources) && resources.length > 0 ? 'legacy' : 'unique';
}
