import { describe, it, expect } from '@rstest/core';
import { toScreamingSnakeCase } from './to-screaming-snake-case';

describe('toScreamingSnakeCase', () => {
  it('should convert kebab-case to SCREAMING_SNAKE_CASE', () => {
    expect(toScreamingSnakeCase('test-service')).toBe('TEST_SERVICE');
  });

  it('should convert auth-service correctly', () => {
    expect(toScreamingSnakeCase('auth-service')).toBe('AUTH_SERVICE');
  });

  it('should handle multiple hyphens', () => {
    expect(toScreamingSnakeCase('my-long-service-name')).toBe(
      'MY_LONG_SERVICE_NAME',
    );
  });

  it('should handle no hyphens', () => {
    expect(toScreamingSnakeCase('service')).toBe('SERVICE');
  });

  it('should handle already uppercase', () => {
    expect(toScreamingSnakeCase('TEST')).toBe('TEST');
  });

  it('should handle empty string', () => {
    expect(toScreamingSnakeCase('')).toBe('');
  });

  it('should handle mixed case input', () => {
    expect(toScreamingSnakeCase('Auth-Service')).toBe('AUTH_SERVICE');
  });
});
