/**
 * Next steps after infra:remove-service, the same on every cloud
 */

import { getContext } from '../../context';

/**
 * After the cloud removal: take the service out of the project, then deploy.
 * infra:deploy regenerates Terraform and Kong from config.json, so it also
 * removes what infra:remove-service leaves: the service's Kong routes, its
 * load balancer or edge routes (GCP's backend bucket and URL map host rule,
 * AWS's listener rules, Azure's Front Door route) and the scheduled jobs
 * that call it (Terraform's on every cloud).
 *
 * @param serviceName - The removed service
 * @param targetEnv - Environment it was removed from
 */
export function logRemoveServiceNextSteps(
  serviceName: string,
  targetEnv: string,
): void {
  const { logger } = getContext();

  logger.info('Next steps:');
  logger.info('  1. Remove it from the other environments (if deployed)');
  logger.info(
    `  2. npx tsdevstack remove-service ${serviceName}  # removes it from the project`,
  );
  logger.info(
    `  3. npx tsdevstack infra:deploy --env ${targetEnv}  # removes its Kong and load balancer routes`,
  );
  logger.newline();

  logger.warn(
    'Until infra:deploy runs, its Kong routes return 502, scheduled jobs that call it fail, and a domain it had stops working.',
  );
}
