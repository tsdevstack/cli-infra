import { describe, it, expect } from '@rstest/core';
import { formatRunDuration } from './format-run-duration';

describe('formatRunDuration', () => {
  describe('Standard use cases', () => {
    it('should show milliseconds under a second', () => {
      expect(formatRunDuration(3)).toBe('3 ms');
      expect(formatRunDuration(742)).toBe('742 ms');
    });

    it('should show seconds with one decimal under a minute', () => {
      expect(formatRunDuration(1000)).toBe('1.0 s');
      expect(formatRunDuration(8648)).toBe('8.6 s');
    });

    it('should show minutes and seconds from a minute on', () => {
      expect(formatRunDuration(68648)).toBe('1 min 9 s');
      expect(formatRunDuration(725000)).toBe('12 min 5 s');
    });
  });

  describe('Edge cases', () => {
    it('should show zero as 0 ms', () => {
      expect(formatRunDuration(0)).toBe('0 ms');
    });

    it('should not show 60.0 s just under a minute', () => {
      expect(formatRunDuration(59960)).toBe('1 min 0 s');
      expect(formatRunDuration(59940)).toBe('59.9 s');
    });

    it('should round fractions of a millisecond', () => {
      expect(formatRunDuration(2.6)).toBe('3 ms');
    });
  });
});
