/**
 * Build the Terraform map key for a scheduled job
 *
 * This key is used in the scheduled_jobs map in terraform.tfvars
 * and becomes the for_each key in aws_scheduler_schedule.job["key"].
 *
 * Must match the key format in generate-terraform-files.ts.
 */
export function buildScheduledJobKey(
  targetService: string,
  jobName: string,
): string {
  return `${targetService}-${jobName}`;
}
