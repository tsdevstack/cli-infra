import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockExecSync = rs.fn();
rs.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

import { fetchSecret } from './fetch-secret';

describe('fetchSecret', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('successful fetch', () => {
    it('should return trimmed secret value', () => {
      mockExecSync.mockReturnValue('my-secret-value\n');

      const result = fetchSecret('MY_KEY', 'prod');

      expect(result).toBe('my-secret-value');
    });

    it('should call CLI with correct arguments', () => {
      mockExecSync.mockReturnValue('value');

      fetchSecret('DB_AUTH_PASSWORD', 'dev');

      expect(mockExecSync).toHaveBeenCalledWith(
        'npx tsdevstack cloud-secrets:get DB_AUTH_PASSWORD --env dev',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
    });

    it('should handle empty value', () => {
      mockExecSync.mockReturnValue('');

      const result = fetchSecret('MY_KEY', 'prod');

      expect(result).toBe('');
    });

    it('should handle value with whitespace', () => {
      mockExecSync.mockReturnValue('  secret  \n');

      const result = fetchSecret('MY_KEY', 'prod');

      expect(result).toBe('secret');
    });
  });

  describe('failed fetch', () => {
    it('should return null when command fails', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed');
      });

      const result = fetchSecret('NONEXISTENT_KEY', 'prod');

      expect(result).toBeNull();
    });

    it('should return null when secret not found', () => {
      mockExecSync.mockImplementation(() => {
        const error = new Error('Secret not found');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        throw error;
      });

      const result = fetchSecret('MY_KEY', 'prod');

      expect(result).toBeNull();
    });
  });
});
