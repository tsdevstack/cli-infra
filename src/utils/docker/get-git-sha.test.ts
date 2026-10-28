import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';
import { execSync } from 'node:child_process';
import { getGitSha } from './get-git-sha';
import { hasUncommittedSourceChanges } from './has-uncommitted-source-changes';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('node:child_process', { mock: true });
rs.mock('./has-uncommitted-source-changes', () => ({
  hasUncommittedSourceChanges: rs.fn(() => false),
}));
rs.mock('../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

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

  describe('uncommitted changes', () => {
    it('should not warn for a clean checkout', () => {
      rs.mocked(execSync).mockReturnValue('abc1234');
      rs.mocked(hasUncommittedSourceChanges).mockReturnValue(false);

      getGitSha();

      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('should warn once per run that the tag is the last commit', () => {
      rs.mocked(execSync).mockReturnValue('abc1234');
      rs.mocked(hasUncommittedSourceChanges).mockReturnValue(true);

      expect(getGitSha()).toBe('abc1234');
      expect(getGitSha()).toBe('abc1234');

      expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('last commit (abc1234)'),
      );
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
