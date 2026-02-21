import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { execSync } from 'node:child_process';
import { getGitSha } from './get-git-sha';

rs.mock('node:child_process', { mock: true });

describe('getGitSha', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('when git command succeeds', () => {
    it('should return trimmed git SHA', () => {
      rs.mocked(execSync).mockReturnValue('abc1234\n');

      const result = getGitSha();

      expect(result).toBe('abc1234');
    });

    it('should call git rev-parse with short flag', () => {
      rs.mocked(execSync).mockReturnValue('abc1234');

      getGitSha();

      expect(execSync).toHaveBeenCalledWith('git rev-parse --short HEAD', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    });

    it('should handle SHA without trailing whitespace', () => {
      rs.mocked(execSync).mockReturnValue('def5678');

      const result = getGitSha();

      expect(result).toBe('def5678');
    });

    it('should handle SHA with multiple trailing newlines', () => {
      rs.mocked(execSync).mockReturnValue('ghi9012\n\n');

      const result = getGitSha();

      expect(result).toBe('ghi9012');
    });
  });

  describe('when git command fails', () => {
    it('should throw error', () => {
      rs.mocked(execSync).mockImplementation(() => {
        throw new Error('not a git repository');
      });

      expect(() => getGitSha()).toThrow('not a git repository');
    });
  });
});
