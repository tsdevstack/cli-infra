import { describe, it, expect } from '@rstest/core';
import { toTfVarSuffix } from './to-tf-var-suffix';

describe('toTfVarSuffix', () => {
  it('should remove -service suffix and replace hyphens', () => {
    expect(toTfVarSuffix('auth-service')).toBe('auth');
    expect(toTfVarSuffix('offers-service')).toBe('offers');
    expect(toTfVarSuffix('bff-service')).toBe('bff');
  });

  it('should handle multi-word service names', () => {
    expect(toTfVarSuffix('user-auth-service')).toBe('user_auth');
    expect(toTfVarSuffix('api-gateway-service')).toBe('api_gateway');
  });

  it('should handle names without -service suffix', () => {
    expect(toTfVarSuffix('frontend')).toBe('frontend');
    expect(toTfVarSuffix('api-gateway')).toBe('api_gateway');
  });

  it('should replace hyphens with underscores', () => {
    expect(toTfVarSuffix('my-test-name')).toBe('my_test_name');
  });

  it('should handle single word names', () => {
    expect(toTfVarSuffix('api')).toBe('api');
  });

  it('should only remove trailing -service', () => {
    expect(toTfVarSuffix('service-manager')).toBe('service_manager');
  });
});
