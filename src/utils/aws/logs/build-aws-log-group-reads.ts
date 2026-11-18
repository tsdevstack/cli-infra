/**
 * Plan the CloudWatch Logs reads for a query: one per source and log group.
 *
 * - Services, workers, frontends, Kong: `/ecs/{project}/{name}` (app lines)
 * - Migrations: `/ecs/{project}/{name}`, and `/ecs/{name}-migration`, the
 *   name before the project was in it (app lines)
 * - Scheduled jobs: the job function's group, lines starting with
 *   `job=<name>` (platform lines: the platform runs the job)
 * - Storage buckets: the storage trail's group, the bucket's events
 *   (platform lines; their level comes from the event, so --level is left
 *   to the printer)
 * - Edge: the WAF group in us-east-1
 *
 * Platform lines of services and migrations come from ECS, not from here.
 * `--level` becomes a JSON filter: lines without a JSON level don't match,
 * which leaves out plain text, as on every provider.
 */

import {
  AWS_ECS_LOG_GROUP_PREFIX,
  AWS_JOB_INVOKER_LOG_GROUP_PREFIX,
  AWS_JOB_INVOKER_SUFFIX,
  AWS_JOB_LINE_PREFIX,
  AWS_STORAGE_ACCESS_LOG_GROUP_PREFIX,
  AWS_STORAGE_ACCESS_LOG_GROUP_SUFFIX,
  AWS_WAF_LOG_GROUP_PREFIX,
  AWS_WAF_LOG_REGION,
  LOG_LEVELS,
  MIGRATION_LOG_SOURCE_PREFIX,
} from '../../../constants';
import { buildS3StorageBucketName } from '@tsdevstack/infra-core';
import type { LogKind, LogLevel, LogSource } from '../../logs/types';
import type { AwsLogGroupRead } from './types';
import { buildAwsJobLineName } from './build-aws-job-line-name';
import { buildAwsMigrationNames } from '../build-aws-migration-names';

/** pino labels at or above each level (pino's trace counts as debug) */
const PINO_LABELS: Record<LogLevel, string[]> = {
  debug: ['trace', 'debug'],
  info: ['info'],
  warn: ['warn'],
  error: ['error'],
  fatal: ['fatal'],
};

export function buildAwsLogGroupReads(
  sources: LogSource[],
  params: {
    projectName: string;
    targetEnv: string;
    region: string;
    /** Storage buckets' names end in the account ID */
    accountId: string;
    kind?: LogKind;
    level?: LogLevel;
  },
): AwsLogGroupRead[] {
  const { projectName, targetEnv, region, kind, level } = params;

  const levelPattern = level
    ? `{ ${LOG_LEVELS.slice(LOG_LEVELS.indexOf(level))
        .flatMap((l) => PINO_LABELS[l])
        .map((label) => `$.level = "${label}"`)
        .join(' || ')} }`
    : undefined;

  const reads: AwsLogGroupRead[] = [];
  for (const source of sources) {
    let read: AwsLogGroupRead;
    switch (source.type) {
      case 'migration': {
        // Both names: a migration logs to the old one until the environment
        // runs one with this CLI
        const names = buildAwsMigrationNames(
          projectName,
          source.name.slice(MIGRATION_LOG_SOURCE_PREFIX.length),
        );
        if (!kind || kind === 'app') {
          for (const logGroupName of [
            names.logGroupName,
            names.legacyLogGroupName,
          ]) {
            reads.push({
              source,
              logGroupName,
              region,
              kind: 'app',
              format: 'app',
              ...(levelPattern && { filterPattern: levelPattern }),
            });
          }
        }
        continue;
      }
      case 'job':
        read = {
          source,
          logGroupName: `${AWS_JOB_INVOKER_LOG_GROUP_PREFIX}${projectName}${AWS_JOB_INVOKER_SUFFIX}`,
          region,
          kind: 'platform',
          format: 'job',
          filterPattern: `"${AWS_JOB_LINE_PREFIX}${buildAwsJobLineName(source)}"`,
        };
        break;
      case 'bucket': {
        if (!source.bucket) {
          continue;
        }
        const bucketName = buildS3StorageBucketName({
          projectName,
          bucket: source.bucket,
          environment: targetEnv,
          accountId: params.accountId,
        });
        read = {
          source,
          logGroupName: `${AWS_STORAGE_ACCESS_LOG_GROUP_PREFIX}${projectName}${AWS_STORAGE_ACCESS_LOG_GROUP_SUFFIX}`,
          region,
          kind: 'platform',
          format: 'bucket',
          filterPattern: `{ $.requestParameters.bucketName = "${bucketName}" }`,
          bucketName,
        };
        break;
      }
      case 'edge':
        read = {
          source,
          logGroupName: `${AWS_WAF_LOG_GROUP_PREFIX}${projectName}-${targetEnv}`,
          region: AWS_WAF_LOG_REGION,
          kind: 'edge',
          format: 'waf',
        };
        break;
      default:
        read = {
          source,
          logGroupName: `${AWS_ECS_LOG_GROUP_PREFIX}${projectName}/${source.name}`,
          region,
          kind: 'app',
          format: 'app',
          ...(levelPattern && { filterPattern: levelPattern }),
        };
    }

    if (!kind || read.kind === kind) {
      reads.push(read);
    }
  }

  return reads;
}
