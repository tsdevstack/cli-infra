/**
 * Execute Steps
 *
 * Execute deletion steps in order, abort on first failure.
 */

import type { DeletionStep, ExecuteStepsResult } from './types';

export interface ExecuteStepsLogger {
  info: (msg: string) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
}

/**
 * Execute deletion steps in order, abort on first failure
 */
export async function executeSteps(
  logger: ExecuteStepsLogger,
  steps: DeletionStep[],
): Promise<ExecuteStepsResult> {
  const completed: DeletionStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    logger.info(`  ${i + 1}. Deleting ${step.name}...`);

    try {
      const result = await step.execute();

      if (!result.success) {
        logger.error(`     Failed: ${result.error}`);
        return {
          completed,
          failed: step,
          remaining: steps.slice(i + 1),
        };
      }

      if (result.deleted) {
        logger.success(`     Deleted`);
      } else {
        logger.info(`     Already gone`);
      }

      completed.push(step);
    } catch (error) {
      logger.error(
        `     Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return {
        completed,
        failed: step,
        remaining: steps.slice(i + 1),
      };
    }
  }

  return { completed, failed: null, remaining: [] };
}
