import { describe, it, expect } from '@rstest/core';
import { padRight } from './pad-right';

describe('padRight', () => {
  it('should pad shorter string with spaces', () => {
    expect(padRight('foo', 6)).toBe('foo   ');
  });

  it('should not truncate longer string', () => {
    expect(padRight('hello', 3)).toBe('hello');
  });

  it('should return same string when length matches', () => {
    expect(padRight('test', 4)).toBe('test');
  });

  it('should handle empty string', () => {
    expect(padRight('', 3)).toBe('   ');
  });

  it('should handle zero length', () => {
    expect(padRight('test', 0)).toBe('test');
  });
});
