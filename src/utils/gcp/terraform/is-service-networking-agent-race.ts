/**
 * Is Service Networking Agent Race
 *
 * Recognizes the failed first apply of a new GCP project: Google creates the
 * Service Networking service agent on the first CreateConnection call, and
 * that call's operation can fail with "Error code 16 ... invalid
 * authentication credentials" while the agent is being created. The same
 * deploy key created every other resource, so it is not a credential
 * problem; applying again after a short wait passes.
 */

import { getTerraformErrors } from '../../terraform';

const SERVICE_NETWORKING_CONNECTION = 'Service Networking Connection';
const UNAUTHENTICATED = 'Error code 16';

/**
 * Whether every error of a failed apply is the Service Networking agent race
 *
 * @param output - Terraform's combined output
 * @returns True when the only errors are that one
 */
export function isServiceNetworkingAgentRace(output: string): boolean {
  const errors = getTerraformErrors(output);
  return (
    errors.length > 0 &&
    errors.every(
      (error) =>
        error.includes(SERVICE_NETWORKING_CONNECTION) &&
        error.includes(UNAUTHENTICATED),
    )
  );
}
