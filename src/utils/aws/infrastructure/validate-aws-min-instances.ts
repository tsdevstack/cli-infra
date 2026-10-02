/**
 * Validate AWS minInstances
 *
 * AWS has no scale-to-zero: every ECS service (Kong included) runs at least
 * one task. Backend services are reachable only inside the VPC, so there is no
 * public entry point that could wake a stopped service.
 * GCP and Azure keep allowing minInstances: 0 (native scale-to-zero).
 */

import { getContext } from '../../../context';
import { VALIDATION_CONSTRAINTS } from '../../../constants';

/**
 * Validate that minInstances is at least VALIDATION_CONSTRAINTS.minInstancesAws.min
 * (1) for an AWS service or Kong.
 *
 * @param minInstances - The configured (or resolved) minInstances value
 * @param context - Error context string (e.g., "dev.auth-service", "dev.kong")
 * @throws CliError if minInstances is below 1
 */
export function validateAwsMinInstances(
  minInstances: number,
  context: string,
): void {
  const { CliError } = getContext();
  const minimum = VALIDATION_CONSTRAINTS.minInstancesAws.min;

  if (minInstances < minimum) {
    throw new CliError(
      `minInstances: ${minInstances} is not supported on AWS (${context})`,
      'Infrastructure Config',
      `AWS has no scale-to-zero: every service runs at least one task. Set "minInstances" to ${minimum} or more for ${context} in .tsdevstack/infrastructure.json (or remove it to use the default).`,
    );
  }
}
