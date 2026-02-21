/**
 * CI/CD Types
 *
 * Type definitions for CI configuration and workflow generation.
 */

/**
 * CI provider (only GitHub supported currently)
 */
export type CIProvider = 'github';

/**
 * CI configuration file structure (.tsdevstack/ci.json)
 */
export interface CIConfig {
  /** CI provider */
  provider: CIProvider;
  /** Target deployment environments */
  environments: string[];
}
