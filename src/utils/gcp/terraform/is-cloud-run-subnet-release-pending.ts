/**
 * Is Cloud Run Subnet Release Pending
 *
 * Recognizes the Terraform error of a destroy that cannot delete the subnet
 * because Cloud Run still holds a `serverless-ipv4-*` address in it
 * (released 1 to 2 hours after the Cloud Run resources are deleted).
 */

import { GCP_CLOUD_RUN_SUBNET_ADDRESS_PREFIX } from '../../../constants';

/**
 * Whether a Terraform error is the "subnet still used by Cloud Run" error
 *
 * @param error - One error from Terraform's output (getTerraformErrors)
 * @returns True when a resource is in use by a Cloud Run subnet address
 */
export function isCloudRunSubnetReleasePending(error: string): boolean {
  const inUse =
    error.includes('resourceInUseByAnotherResource') ||
    error.includes('already being used by');
  return inUse && error.includes(GCP_CLOUD_RUN_SUBNET_ADDRESS_PREFIX);
}
