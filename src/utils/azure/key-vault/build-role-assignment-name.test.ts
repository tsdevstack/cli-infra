import { describe, it, expect } from '@rstest/core';
import { buildRoleAssignmentName } from './build-role-assignment-name';

const GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('buildRoleAssignmentName', () => {
  describe('Standard use cases', () => {
    it('should return a GUID', () => {
      expect(buildRoleAssignmentName('/scope', 'principal', 'role')).toMatch(
        GUID,
      );
    });

    it('should return the same name for the same grant', () => {
      expect(buildRoleAssignmentName('/scope', 'principal', 'role')).toBe(
        buildRoleAssignmentName('/scope', 'principal', 'role'),
      );
    });
  });

  describe('Edge cases', () => {
    it('should differ when the scope, principal or role differs', () => {
      const base = buildRoleAssignmentName('/scope', 'principal', 'role');
      expect(buildRoleAssignmentName('/other', 'principal', 'role')).not.toBe(
        base,
      );
      expect(buildRoleAssignmentName('/scope', 'other', 'role')).not.toBe(base);
      expect(buildRoleAssignmentName('/scope', 'principal', 'other')).not.toBe(
        base,
      );
    });
  });
});
