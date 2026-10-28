/**
 * Is Service Networking Release Pending
 *
 * Recognizes the Terraform error of a destroy that cannot delete the private
 * service connection right after the database: Google still counts the
 * deleted Cloud SQL (or Memorystore) instance as using it for a while.
 */

/**
 * Whether a Terraform error is the "connection still used by a producer
 * service" error
 *
 * @param error - One error from Terraform's output (getTerraformErrors)
 * @returns True when Google has not released the private service connection
 */
export function isServiceNetworkingReleasePending(error: string): boolean {
  return (
    error.includes('Service Networking Connection') &&
    error.includes('are still using this connection')
  );
}
