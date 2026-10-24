import { describe, it, expect } from '@rstest/core';
import { isCloudRunSubnetReleasePending } from './is-cloud-run-subnet-release-pending';

const SUBNET_IN_USE =
  "Error: Error when reading or editing Subnetwork: googleapi: Error 400: The subnetwork resource 'projects/p/regions/us-central1/subnetworks/my-app-subnet' is already being used by 'projects/p/regions/us-central1/addresses/serverless-ipv4-cloudrun-123', resourceInUseByAnotherResource";

describe('isCloudRunSubnetReleasePending', () => {
  describe('Standard use cases', () => {
    it('should recognize a subnet held by a Cloud Run address', () => {
      expect(isCloudRunSubnetReleasePending(SUBNET_IN_USE)).toBe(true);
    });

    it('should recognize the error code alone with the Cloud Run address', () => {
      expect(
        isCloudRunSubnetReleasePending(
          'Error 400: serverless-ipv4-cloudrun-123, resourceInUseByAnotherResource',
        ),
      ).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should not match a resource in use by something else', () => {
      expect(
        isCloudRunSubnetReleasePending(
          "Error 400: The network resource 'projects/p/global/networks/n' is already being used by 'projects/p/global/firewalls/f', resourceInUseByAnotherResource",
        ),
      ).toBe(false);
    });

    it('should not match other errors that mention the address', () => {
      expect(
        isCloudRunSubnetReleasePending(
          'Error 403: permission denied on serverless-ipv4-cloudrun-123',
        ),
      ).toBe(false);
    });

    it('should not match empty output', () => {
      expect(isCloudRunSubnetReleasePending('')).toBe(false);
    });
  });
});
