/**
 * AWS constants for infra:logs (CloudWatch Logs, ECS)
 */

/** Sources that run as ECS services (their events and stopped tasks are platform lines) */
export const AWS_ECS_SERVICE_LOG_SOURCE_TYPES = [
  'service',
  'worker',
  'frontend',
  'kong',
] as const;

/** ECS cluster of an environment: `{project}-cluster` */
export const AWS_ECS_CLUSTER_SUFFIX = '-cluster';

/** Log group of a service, worker, frontend or Kong: `/ecs/{project}/{name}` */
export const AWS_ECS_LOG_GROUP_PREFIX = '/ecs/';

/**
 * Suffix of a migration's task family and log group before the project was
 * in their names (`migrate-{service}-migration`, `/ecs/migrate-{service}-migration`);
 * still read and deleted (buildAwsMigrationNames)
 */
export const AWS_MIGRATION_TASK_FAMILY_SUFFIX = '-migration';

/**
 * Task family of the database setup job: `{project}-db-init` (its log group
 * is `/ecs/{project}/db-init`, read like a service's)
 */
export const AWS_DB_INIT_TASK_FAMILY_SUFFIX = '-db-init';

/** The scheduled job function's log group: `/aws/lambda/{project}-job-invoker` */
export const AWS_JOB_INVOKER_LOG_GROUP_PREFIX = '/aws/lambda/';
export const AWS_JOB_INVOKER_SUFFIX = '-job-invoker';

/** Every line the job function writes starts with `job=<name> ` */
export const AWS_JOB_LINE_PREFIX = 'job=';

/**
 * The storage buckets' access log group, written by the storage trail
 * (`/aws/cloudtrail/{project}-storage-access`)
 */
export const AWS_STORAGE_ACCESS_LOG_GROUP_PREFIX = '/aws/cloudtrail/';

/**
 * The VPC flow log's group (`/aws/vpc/flowlogs/{project}`), the name infra-core's
 * generate-vpc-flow-logs-tf.ts gives it
 */
export const AWS_VPC_FLOW_LOG_GROUP_PREFIX = '/aws/vpc/flowlogs/';
export const AWS_STORAGE_ACCESS_LOG_GROUP_SUFFIX = '-storage-access';

/** WAF log group (`aws-waf-logs-{project}-{env}`), in us-east-1 with CloudFront */
export const AWS_WAF_LOG_GROUP_PREFIX = 'aws-waf-logs-';
export const AWS_WAF_LOG_REGION = 'us-east-1';

/** Events per FilterLogEvents call (the API maximum) */
export const AWS_LOGS_PAGE_SIZE = 10000;

/** Newest-first reads (startFromHead false) only work from this time on */
export const AWS_LOGS_NEWEST_FIRST_EARLIEST = Date.UTC(2024, 0, 1);

/** Parallel CloudWatch Logs calls (FilterLogEvents allows 5 to 25 per second) */
export const AWS_LOGS_CONCURRENCY = 3;

/** --follow: log groups per Live Tail session (AWS's limit, fixed) */
export const AWS_LIVE_TAIL_MAX_LOG_GROUPS = 10;

/** --follow: log group names per DescribeLogGroups call (the API maximum) */
export const AWS_DESCRIBE_LOG_GROUPS_BATCH = 50;

/** --follow: how often ECS is asked for new platform lines (events, stopped tasks) */
export const AWS_LOGS_FOLLOW_ECS_POLL_MS = 10_000;

/**
 * --follow: each ECS poll looks this far back past the previous one, for
 * events ECS shows late; lines seen before are not printed again
 */
export const AWS_LOGS_FOLLOW_ECS_OVERLAP_MS = 60_000;
