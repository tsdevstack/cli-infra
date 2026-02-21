import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockSpawnSync = rs.fn();
rs.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

import { setSecretViaCli } from './set-secret-via-cli';

describe('setSecretViaCli', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('successful secret setting', () => {
    it('should call spawnSync with correct arguments', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      setSecretViaCli('REDIS_HOST', '10.0.0.5', 'prod');

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'npx',
        [
          'tsdevstack',
          'cloud-secrets:set',
          'REDIS_HOST',
          '--value',
          '10.0.0.5',
          '--env',
          'prod',
          '--overwrite',
        ],
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    it('should not throw on success', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      expect(() => setSecretViaCli('KEY', 'value', 'dev')).not.toThrow();
    });

    it('should handle values with special characters', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      setSecretViaCli('KEY', 'pass=word!@#$%', 'dev');

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'npx',
        [
          'tsdevstack',
          'cloud-secrets:set',
          'KEY',
          '--value',
          'pass=word!@#$%',
          '--env',
          'dev',
          '--overwrite',
        ],
        expect.any(Object),
      );
    });

    it('should handle multiline values', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      const multilineValue = 'line1\nline2\nline3';
      setSecretViaCli('KEY', multilineValue, 'dev');

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'npx',
        [
          'tsdevstack',
          'cloud-secrets:set',
          'KEY',
          '--value',
          multilineValue,
          '--env',
          'dev',
          '--overwrite',
        ],
        expect.any(Object),
      );
    });
  });

  describe('failed secret setting', () => {
    it('should throw error when command fails', () => {
      mockSpawnSync.mockReturnValue({ status: 1, stderr: 'Permission denied' });

      expect(() => setSecretViaCli('KEY', 'value', 'prod')).toThrow(
        'Permission denied',
      );
    });

    it('should throw generic error when stderr is empty', () => {
      mockSpawnSync.mockReturnValue({ status: 1, stderr: '' });

      expect(() => setSecretViaCli('KEY', 'value', 'prod')).toThrow(
        'Failed to set secret',
      );
    });

    it('should throw error with non-zero exit code', () => {
      mockSpawnSync.mockReturnValue({
        status: 127,
        stderr: 'Command not found',
      });

      expect(() => setSecretViaCli('KEY', 'value', 'prod')).toThrow(
        'Command not found',
      );
    });
  });

  describe('shell injection prevention', () => {
    it('should use args array instead of string interpolation', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      // Attempt shell injection via value
      setSecretViaCli('KEY', '"; rm -rf /', 'dev');

      // Verify the value is passed as a separate argument, not interpolated
      const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
      expect(args[4]).toBe('"; rm -rf /'); // Value should be passed literally
    });

    it('should safely handle keys with shell metacharacters', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      setSecretViaCli('KEY$(whoami)', 'value', 'dev');

      const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
      expect(args[2]).toBe('KEY$(whoami)'); // Key should be passed literally
    });
  });
});
