/**
 * Build GCP SPA Bucket Name
 *
 * The GCS bucket an SPA is served from, named exactly as Terraform names it
 * (generate-spa-buckets-tf.ts: "${var.project_name}-${service}-spa-${var.gcp_project_id}").
 * The GCP project ID makes the name unique worldwide, as GCS requires.
 */

/**
 * The SPA's bucket name
 *
 * @param projectName - Project name
 * @param serviceName - SPA service name
 * @param gcpProjectId - GCP project ID of the environment
 * @returns "{project}-{service}-spa-{gcpProjectId}"
 */
export function buildGcpSpaBucketName(
  projectName: string,
  serviceName: string,
  gcpProjectId: string,
): string {
  return `${projectName}-${serviceName}-spa-${gcpProjectId}`;
}
