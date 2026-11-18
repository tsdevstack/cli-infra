import { describe, it, expect } from '@rstest/core';
import { isGcpNotFoundError } from './is-gcp-not-found-error';

describe('isGcpNotFoundError', () => {
  describe('Standard use cases', () => {
    it('should read the status where each client puts it', () => {
      expect(isGcpNotFoundError({ code: 404 })).toBe(true);
      expect(isGcpNotFoundError({ status: 404 })).toBe(true);
      expect(isGcpNotFoundError({ response: { status: 404 } })).toBe(true);
    });

    it('should not take another status for not found', () => {
      expect(isGcpNotFoundError({ status: 403 })).toBe(false);
      expect(isGcpNotFoundError({ response: { status: 500 } })).toBe(false);
      expect(isGcpNotFoundError({ code: 'ENOTFOUND' })).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should answer false for anything that is not an error object', () => {
      expect(isGcpNotFoundError(undefined)).toBe(false);
      expect(isGcpNotFoundError(null)).toBe(false);
      expect(isGcpNotFoundError('404')).toBe(false);
      expect(isGcpNotFoundError(new Error('404 Not Found'))).toBe(false);
    });
  });
});
