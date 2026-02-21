import { describe, it, expect } from '@rstest/core';
import { toDnsAuthName } from './to-dns-auth-name';

describe('toDnsAuthName', () => {
  it('should replace dots with hyphens', () => {
    expect(toDnsAuthName('api.example.com')).toBe('api-example-com');
  });

  it('should handle single-level domain', () => {
    expect(toDnsAuthName('localhost')).toBe('localhost');
  });

  it('should handle multiple dots', () => {
    expect(toDnsAuthName('sub.domain.example.com')).toBe(
      'sub-domain-example-com',
    );
  });

  it('should handle domain without dots', () => {
    expect(toDnsAuthName('example')).toBe('example');
  });
});
