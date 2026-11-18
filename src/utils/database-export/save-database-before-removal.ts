/**
 * Save a service's database before infra:remove-service drops it (every cloud)
 */

import inquirer from 'inquirer';
import { getContext } from '../../context';
import { describeSaveFailure } from './describe-save-failure';

export interface SaveDatabaseBeforeRemovalOptions {
  /** Runs the cloud's database job that saves the file; throws on failure */
  save: () => Promise<void>;
  /** A terminal: after two failures, ask what to do */
  interactive: boolean;
}

/** saved, skipped (the user chose to remove without it) or stopped */
export type SaveDatabaseOutcome =
  | { outcome: 'saved' }
  | { outcome: 'skipped' }
  | { outcome: 'stopped'; error: string };

/**
 * The save runs right before the database is dropped, after the service is
 * deleted, so nothing writes in between. A failure leaves the database
 * untouched. It is tried once more on its own (a network drop, the database
 * restarting); after a second failure a terminal asks: stop (the default),
 * try again, or remove without saving. In CI it stops, and the error names
 * --skip-export.
 *
 * @param options - The cloud's save, and whether someone can answer
 * @returns What happened
 */
export async function saveDatabaseBeforeRemoval(
  options: SaveDatabaseBeforeRemovalOptions,
): Promise<SaveDatabaseOutcome> {
  const { logger } = getContext();

  for (let attempt = 1; ; attempt++) {
    try {
      await options.save();
      return { outcome: 'saved' };
    } catch (error) {
      const reason = describeSaveFailure(error);
      if (attempt === 1) {
        logger.warn(`     Saving failed, trying once more: ${reason[0]}`);
        continue;
      }

      logger.error('     Saving the database failed:');
      for (const line of reason) {
        logger.error(`       ${line}`);
      }

      if (!options.interactive) {
        return {
          outcome: 'stopped',
          error:
            'The database could not be saved, so it was not dropped. Fix the cause and run the command again, or add --skip-export to remove the service without saving its data.',
        };
      }

      const { choice } = await inquirer.prompt([
        {
          type: 'select',
          name: 'choice',
          message: 'The database could not be saved. What now?',
          choices: [
            { name: 'Stop (the database stays as it is)', value: 'stop' },
            { name: 'Try again', value: 'retry' },
            { name: 'Remove without saving the data', value: 'skip' },
          ],
          default: 'stop',
        },
      ]);
      if (choice === 'retry') continue;
      if (choice === 'skip') return { outcome: 'skipped' };
      return {
        outcome: 'stopped',
        error:
          'Stopped: the database was not saved, so it was not dropped. Run the command again to carry on.',
      };
    }
  }
}
