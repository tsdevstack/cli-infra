/**
 * AWS infra:logs Types
 */

import type { LogKind, LogSource } from '../../logs/types';

/** How a log group's lines are written */
export type AwsLogLineFormat = 'app' | 'job' | 'waf' | 'bucket';

/**
 * One CloudWatch Logs read for one source
 */
export interface AwsLogGroupRead {
  source: LogSource;
  logGroupName: string;
  region: string;
  kind: LogKind;
  format: AwsLogLineFormat;
  /** CloudWatch filter pattern (a job's or a bucket's lines, or the level of JSON lines) */
  filterPattern?: string;
  /**
   * Storage buckets: the S3 bucket's name. The trail's group holds every
   * bucket; --follow picks the bucket's lines itself (one Live Tail session
   * takes one filter pattern)
   */
  bucketName?: string;
}

/**
 * One Live Tail session for --follow: up to AWS_LIVE_TAIL_MAX_LOG_GROUPS
 * log groups in one region, and the reads they serve
 */
export interface AwsLiveTailSession {
  region: string;
  /** Existing log groups (missing ones are left out) */
  logGroups: Array<{ name: string; arn: string }>;
  reads: AwsLogGroupRead[];
  /** Only when every read of the session has the same one */
  filterPattern?: string;
}

/** An existing log group, from DescribeLogGroups */
export interface AwsExistingLogGroup {
  /** Without the trailing `:*` (what Live Tail takes) */
  arn: string;
  /** STANDARD, INFREQUENT_ACCESS, ... */
  logGroupClass?: string;
}
