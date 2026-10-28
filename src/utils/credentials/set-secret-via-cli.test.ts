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
    it('should pass the value on standard input, not as an argument', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      setSecretViaCli('REDIS_PASSWORD', 'p@ss', 'prod');

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'npx',
        [
          'tsdevstack',
          'cloud-secrets:set',
          'REDIS_PASSWORD',
          '--stdin',
          '--env',
          'prod',
          '--overwrite',
        ],
        {
          encoding: 'utf-8',
          input: 'p@ss',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
      expect(args).not.toContain('p@ss');
    });

    it('should pass the service scope', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      setSecretViaCli('DATABASE_URL', 'postgresql://x', 'dev', 'auth-service');

      const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
      expect(args.slice(-2)).toEqual(['--service', 'auth-service']);
    });

    it('should not throw on success', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      expect(() => setSecretViaCli('KEY', 'value', 'dev')).not.toThrow();
    });

    it('should pass multiline values unchanged', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      const multilineValue = 'line1\nline2\nline3';
      setSecretViaCli('KEY', multilineValue, 'dev');

      const [, , options] = mockSpawnSync.mock.calls[0] as [
        string,
        string[],
        { input: string },
      ];
      expect(options.input).toBe(multilineValue);
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
    it('should pass a value with shell metacharacters as input, untouched', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      setSecretViaCli('KEY', '"; rm -rf /', 'dev');

      const [, args, options] = mockSpawnSync.mock.calls[0] as [
        string,
        string[],
        { input: string },
      ];
      expect(options.input).toBe('"; rm -rf /');
      expect(args).not.toContain('"; rm -rf /');
    });

    it('should safely handle keys with shell metacharacters', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stderr: '' });

      setSecretViaCli('KEY$(whoami)', 'value', 'dev');

      const [, args] = mockSpawnSync.mock.calls[0] as [string, string[]];
      expect(args[2]).toBe('KEY$(whoami)'); // Key should be passed literally
    });
  });
});
