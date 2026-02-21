/**
 * Build the Terraform map key for a scheduled job
 *
 * This key is used in the scheduled_jobs map in terraform.tfvars
 * and becomes the for_each key in azurerm_container_app_job.scheduled_jobs["key"].
 * Also used as the Container App Job name suffix: ${project_name}-${key}.
 *
 * Uses just the job name (not service-prefixed) to stay within Azure's
 * 32-character Container App Job name limit.
 *
 * Must match the key format in generate-terraform-files.ts.
 */
export function buildScheduledJobKey(
  _targetService: string,
  jobName: string,
): string {
  return jobName;
}
