/**
 * The key of a scheduled job on AWS: its EventBridge schedule
 * ({project}-{key}), and the `jobName` the job function writes at the start
 * of every line (`job=<key>`), which infra:logs reads it by.
 *
 * The service is part of it so two services can each have a job of the
 * same name.
 */
export function buildAwsJobKey(targetService: string, jobName: string): string {
  return `${targetService}-${jobName}`;
}
