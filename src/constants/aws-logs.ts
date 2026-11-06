/**
 * AWS constants for infra:logs (CloudWatch Logs, ECS)
 */

/** ECS cluster of an environment: `{project}-cluster` */
export const AWS_ECS_CLUSTER_SUFFIX = '-cluster';

/** Log group of a service, worker, frontend or Kong: `/ecs/{project}/{name}` */
export const AWS_ECS_LOG_GROUP_PREFIX = '/ecs/';

/** A migration's task family (`{name}-migration`) and log group (`/ecs/{family}`) */
export const AWS_MIGRATION_TASK_FAMILY_SUFFIX = '-migration';

/** The scheduled job function's log group: `/aws/lambda/{project}-job-invoker` */
export const AWS_JOB_INVOKER_LOG_GROUP_PREFIX = '/aws/lambda/';
export const AWS_JOB_INVOKER_SUFFIX = '-job-invoker';

/** Every line the job function writes starts with `job=<name> ` */
export const AWS_JOB_LINE_PREFIX = 'job=';

/** WAF log group (`aws-waf-logs-{project}-{env}`), in us-east-1 with CloudFront */
export const AWS_WAF_LOG_GROUP_PREFIX = 'aws-waf-logs-';
export const AWS_WAF_LOG_REGION = 'us-east-1';

/** Events per FilterLogEvents call (the API maximum) */
export const AWS_LOGS_PAGE_SIZE = 10000;

/** Newest-first reads (startFromHead false) only work from this time on */
export const AWS_LOGS_NEWEST_FIRST_EARLIEST = Date.UTC(2024, 0, 1);

/** Parallel CloudWatch Logs calls (FilterLogEvents allows 5 to 25 per second) */
export const AWS_LOGS_CONCURRENCY = 3;
