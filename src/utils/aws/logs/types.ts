/**
 * AWS infra:logs Types
 */

import type { LogKind, LogSource } from '../../logs/types';

/** How a log group's lines are written */
export type AwsLogLineFormat = 'app' | 'job' | 'waf';

/**
 * One CloudWatch Logs read for one source
 */
export interface AwsLogGroupRead {
  source: LogSource;
  logGroupName: string;
  region: string;
  kind: LogKind;
  format: AwsLogLineFormat;
  /** CloudWatch filter pattern (a job's lines, or the level of JSON lines) */
  filterPattern?: string;
}
