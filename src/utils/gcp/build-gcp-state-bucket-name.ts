/**
 * Build the name of the GCS bucket that holds the Terraform state
 */

/**
 * The state bucket infra:init creates: `{project}-tf-state-{gcpProjectId}`.
 * Each environment's state is `{env}/default.tfstate` in it (the gcs
 * backend's prefix is the environment).
 *
 * @param projectName - Project name from config.json
 * @param gcpProjectId - The environment's GCP project ID
 * @returns The bucket name
 */
export function buildGcpStateBucketName(
  projectName: string,
  gcpProjectId: string,
): string {
  return `${projectName}-tf-state-${gcpProjectId}`;
}
