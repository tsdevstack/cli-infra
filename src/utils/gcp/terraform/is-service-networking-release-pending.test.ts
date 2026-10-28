import { describe, it, expect } from '@rstest/core';
import { isServiceNetworkingReleasePending } from './is-service-networking-release-pending';

describe('isServiceNetworkingReleasePending', () => {
  describe('Standard use cases', () => {
    it('should recognize the connection still held after the database', () => {
      expect(
        isServiceNetworkingReleasePending(
          'Unable to remove Service Networking Connection, err: Error waiting for Delete Service Networking Connection: Error code 9, message: Failed to delete connection; Producer services (e.g. CloudSQL, Cloud Memstore, etc.) are still using this connection.',
        ),
      ).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should not match other Service Networking errors', () => {
      expect(
        isServiceNetworkingReleasePending(
          'Error waiting for Create Service Networking Connection: Error code 16, message: Request had invalid authentication credentials',
        ),
      ).toBe(false);
    });

    it('should not match unrelated errors', () => {
      expect(
        isServiceNetworkingReleasePending('failed to delete user auth-service'),
      ).toBe(false);
    });
  });
});
