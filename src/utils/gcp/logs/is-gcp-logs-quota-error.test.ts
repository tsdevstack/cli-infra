import { describe, it, expect } from '@rstest/core';
import { isGcpLogsQuotaError } from './is-gcp-logs-quota-error';

describe('isGcpLogsQuotaError', () => {
  describe('Standard use cases', () => {
    it('should recognize HTTP 429 and the gRPC code', () => {
      expect(isGcpLogsQuotaError({ status: 429 })).toBe(true);
      expect(isGcpLogsQuotaError({ code: 429 })).toBe(true);
      expect(isGcpLogsQuotaError({ code: 8 })).toBe(true);
    });

    it("should recognize Google's quota messages", () => {
      expect(
        isGcpLogsQuotaError(
          new Error(
            "Quota exceeded for quota metric 'Read requests' and limit 'Read requests per minute'",
          ),
        ),
      ).toBe(true);
      expect(
        isGcpLogsQuotaError(new Error('8 RESOURCE_EXHAUSTED: quota')),
      ).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should not match other errors', () => {
      expect(
        isGcpLogsQuotaError({ status: 403, message: 'Permission denied' }),
      ).toBe(false);
      expect(isGcpLogsQuotaError(new Error('socket hang up'))).toBe(false);
      expect(isGcpLogsQuotaError(undefined)).toBe(false);
      expect(isGcpLogsQuotaError('429')).toBe(false);
    });
  });
});
