/**
 * Plan the CloudWatch Logs reads for a query: one per source and log group.
 *
 * - Services, workers, frontends, Kong: `/ecs/{project}/{name}` (app lines)
 * - Migrations: `/ecs/{name}-migration` (app lines)
 * - Scheduled jobs: the job function's group, lines starting with
 *   `job=<name>` (platform lines: the platform runs the job)
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
  AWS_MIGRATION_TASK_FAMILY_SUFFIX,
  AWS_WAF_LOG_GROUP_PREFIX,
  AWS_WAF_LOG_REGION,
  LOG_LEVELS,
} from '../../../constants';
import type { LogKind, LogLevel, LogSource } from '../../logs/types';
import type { AwsLogGroupRead } from './types';
import { buildAwsJobLineName } from './build-aws-job-line-name';

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
      case 'migration':
        read = {
          source,
          logGroupName: `${AWS_ECS_LOG_GROUP_PREFIX}${source.name}${AWS_MIGRATION_TASK_FAMILY_SUFFIX}`,
          region,
          kind: 'app',
          format: 'app',
          ...(levelPattern && { filterPattern: levelPattern }),
        };
        break;
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
