import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { execSync } from 'node:child_process';
import { hasUncommittedSourceChanges } from './has-uncommitted-source-changes';

rs.mock('node:child_process', { mock: true });

describe('hasUncommittedSourceChanges', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('Standard use cases', () => {
    it('should report changes git lists', () => {
      rs.mocked(execSync).mockReturnValue(' M apps/auth-service/src/main.ts\n');

      expect(hasUncommittedSourceChanges()).toBe(true);
    });

    it('should report no changes for a clean checkout', () => {
      rs.mocked(execSync).mockReturnValue('');

      expect(hasUncommittedSourceChanges()).toBe(false);
    });

    it('should look at the whole repository except the folders the CLI writes', () => {
      rs.mocked(execSync).mockReturnValue('');

      hasUncommittedSourceChanges();

      const command = rs.mocked(execSync).mock.calls[0][0] as string;
      expect(command).toContain("':/'");
      expect(command).toContain("':(top,exclude)infrastructure'");
      expect(command).toContain("':(top,exclude).tsdevstack'");
    });
  });

  describe('Edge cases', () => {
    it('should report no changes when git fails', () => {
      rs.mocked(execSync).mockImplementation(() => {
        throw new Error('not a git repository');
      });

      expect(hasUncommittedSourceChanges()).toBe(false);
    });
  });
});
