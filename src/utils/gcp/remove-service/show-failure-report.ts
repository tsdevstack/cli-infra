/**
 * Show Failure Report
 *
 * Display failure report with status of all deletion steps.
 */

import type { DeletionStep } from './types';

export interface ShowFailureReportLogger {
  newline: () => void;
  error: (msg: string) => void;
  success: (msg: string) => void;
  info: (msg: string) => void;
}

/**
 * Show failure report with status of all steps
 */
export function showFailureReport(
  logger: ShowFailureReportLogger,
  completed: DeletionStep[],
  failed: DeletionStep,
  remaining: DeletionStep[],
): void {
  logger.newline();
  logger.error(`Failed at: ${failed.name}`);
  logger.newline();

  if (completed.length > 0) {
    logger.success('Already deleted:');
    for (const step of completed) {
      logger.info(`   - ${step.name}: ${step.resource}`);
    }
    logger.newline();
  }

  logger.info('Not yet deleted:');
  logger.info(`   - ${failed.name}: ${failed.resource} (failed)`);
  for (const step of remaining) {
    logger.info(`   - ${step.name}: ${step.resource}`);
  }
  logger.newline();

  logger.info('Re-run the command to retry (deletes are idempotent).');
}
