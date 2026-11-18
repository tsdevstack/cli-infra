/**
 * Next steps after infra:plan
 */

import { getContext } from '../../context';
import { planHasNoChanges } from './plan-has-no-changes';

/**
 * Points to infra:deploy when the plan has something to apply. A plan with
 * no changes gets no deploy hint: Terraform already said so above.
 *
 * @param planOutput - Terraform's combined plan output
 * @param targetEnv - Environment name
 */
export function logPlanNextSteps(planOutput: string, targetEnv: string): void {
  const { logger } = getContext();

  logger.newline();
  if (planHasNoChanges(planOutput)) {
    logger.info(
      'Nothing to deploy: the environment matches the configuration.',
    );
  } else {
    logger.info('To apply these changes, run:');
    logger.info(`  npx tsdevstack infra:deploy --env ${targetEnv}`);
  }
  logger.newline();
}
