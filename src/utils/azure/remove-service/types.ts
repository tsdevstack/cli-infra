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
  /** The progress line (default "Deleting {name}") */
  label?: string;
  /** Shown when it did its work (default "Deleted") */
  doneText?: string;
  /** Shown when it had nothing to do (default "Already gone") */
  skippedText?: string;
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
