import { describe, it, expect } from '@rstest/core';
import { toTerraformId } from './to-terraform-id';

describe('toTerraformId', () => {
  describe('standard names', () => {
    it('should convert hyphens to underscores', () => {
      expect(toTerraformId('auth-service')).toBe('auth_service');
    });

    it('should handle multiple hyphens', () => {
      expect(toTerraformId('user-auth-service')).toBe('user_auth_service');
    });

    it('should handle names without hyphens', () => {
      expect(toTerraformId('auth')).toBe('auth');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(toTerraformId('')).toBe('');
    });

    it('should handle consecutive hyphens', () => {
      expect(toTerraformId('a--b')).toBe('a__b');
    });

    it('should handle leading hyphen', () => {
      expect(toTerraformId('-auth')).toBe('_auth');
    });

    it('should handle trailing hyphen', () => {
      expect(toTerraformId('auth-')).toBe('auth_');
    });

    it('should preserve underscores', () => {
      expect(toTerraformId('auth_service')).toBe('auth_service');
    });

    it('should handle mixed hyphens and underscores', () => {
      expect(toTerraformId('auth-service_v2')).toBe('auth_service_v2');
    });
  });
});
