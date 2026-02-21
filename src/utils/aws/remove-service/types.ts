/**
 * Remove Service Types
 *
 * Shared types used by infra:remove-service command and utilities.
 */

/**
 * A step in the deletion process
 */
export interface DeletionStep {
  name: string;
  resource: string;
  execute: () => Promise<DeletionStepResult>;
}

/**
 * Result of executing a deletion step
 */
export interface DeletionStepResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/**
 * Result of executing all deletion steps
 */
export interface ExecuteStepsResult {
  completed: DeletionStep[];
  failed: DeletionStep | null;
  remaining: DeletionStep[];
}
