/**
 * Build AWS SPA Bucket Name
 *
 * The S3 bucket an SPA is served from, named exactly as Terraform names it
 * (generate-s3-spa-tf.ts: "${project_name}-${each.key}-spa-${aws_account_id}").
 * The account ID makes the name unique worldwide, as S3 requires.
 */

/**
 * The SPA's bucket name
 *
 * @param projectName - Project name
 * @param serviceName - SPA service name
 * @param accountId - AWS account ID of the environment
 * @returns "{project}-{service}-spa-{accountId}"
 */
export function buildAwsSpaBucketName(
  projectName: string,
  serviceName: string,
  accountId: string,
): string {
  return `${projectName}-${serviceName}-spa-${accountId}`;
}
