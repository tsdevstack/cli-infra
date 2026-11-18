import { describe, it, expect } from '@rstest/core';
import { isValidTimeZone } from './is-valid-time-zone';

describe('isValidTimeZone', () => {
  describe('Standard use cases', () => {
    it('should accept IANA time zones', () => {
      expect(isValidTimeZone('UTC')).toBe(true);
      expect(isValidTimeZone('Europe/Budapest')).toBe(true);
      expect(isValidTimeZone('America/New_York')).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should reject names that are not time zones', () => {
      expect(isValidTimeZone('Budapest')).toBe(false);
      expect(isValidTimeZone('CET+1')).toBe(false);
      expect(isValidTimeZone('')).toBe(false);
    });
  });
});
