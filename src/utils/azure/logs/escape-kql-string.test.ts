import { describe, it, expect } from '@rstest/core';
import { escapeKqlString } from './escape-kql-string';

describe('escapeKqlString', () => {
  describe('Standard use cases', () => {
    it('should leave plain text as it is', () => {
      expect(escapeKqlString('req-123')).toBe('req-123');
    });
  });

  describe('Edge cases', () => {
    it('should escape quotes, backslashes and line breaks', () => {
      expect(escapeKqlString('say "hi" \\o/\nnext')).toBe(
        'say \\"hi\\" \\\\o/\\nnext',
      );
    });
  });
});
