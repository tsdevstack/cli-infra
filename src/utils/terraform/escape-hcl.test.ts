import { describe, it, expect } from '@rstest/core';
import { escapeHcl } from './escape-hcl';

describe('escapeHcl', () => {
  it('should escape double quotes', () => {
    expect(escapeHcl('say "hello"')).toBe('say \\"hello\\"');
  });

  it('should escape backslashes', () => {
    expect(escapeHcl('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('should escape both quotes and backslashes', () => {
    expect(escapeHcl('path\\to\\"file"')).toBe('path\\\\to\\\\\\"file\\"');
  });

  it('should escape template interpolation sequences', () => {
    expect(escapeHcl('${jndi:')).toBe('$${jndi:');
  });

  it('should return unchanged string without special chars', () => {
    expect(escapeHcl('simple string')).toBe('simple string');
  });

  it('should handle empty string', () => {
    expect(escapeHcl('')).toBe('');
  });
});
