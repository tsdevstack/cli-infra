import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockFetchSecret = rs.fn();
rs.mock('./fetch-secret', () => ({
  fetchSecret: (...args: unknown[]) => mockFetchSecret(...args),
}));

import { fetchDbPasswordsFromSecretManager } from './fetch-db-passwords-from-secret-manager';

describe('fetchDbPasswordsFromSecretManager', () => {
  beforeEach(() => {
    rs.resetAllMocks();
  });

  describe('successful password retrieval', () => {
    it('should fetch passwords for services with databases', async () => {
      mockFetchSecret
        .mockReturnValueOnce('auth-pass-123')
        .mockReturnValueOnce('offers-pass-456');

      const services = [
        { name: 'auth-service', hasDatabase: true },
        { name: 'offers-service', hasDatabase: true },
      ];

      const result = await fetchDbPasswordsFromSecretManager('prod', services);

      expect(result).toEqual({
        'auth-service': 'auth-pass-123',
        'offers-service': 'offers-pass-456',
      });
    });

    it('should call fetchSecret with correct key format', async () => {
      mockFetchSecret.mockReturnValue('password');

      const services = [{ name: 'auth-service', hasDatabase: true }];

      await fetchDbPasswordsFromSecretManager('dev', services);

      expect(mockFetchSecret).toHaveBeenCalledWith('DB_AUTH_PASSWORD', 'dev');
    });

    it('should skip services without databases', async () => {
      mockFetchSecret.mockReturnValue('auth-pass');

      const services = [
        { name: 'auth-service', hasDatabase: true },
        { name: 'frontend', hasDatabase: false },
      ];

      await fetchDbPasswordsFromSecretManager('prod', services);

      expect(mockFetchSecret).toHaveBeenCalledTimes(1);
      expect(mockFetchSecret).toHaveBeenCalledWith('DB_AUTH_PASSWORD', 'prod');
    });

    it('should handle hyphenated service names', async () => {
      mockFetchSecret.mockReturnValue('password');

      const services = [{ name: 'user-auth-service', hasDatabase: true }];

      await fetchDbPasswordsFromSecretManager('prod', services);

      expect(mockFetchSecret).toHaveBeenCalledWith(
        'DB_USER_AUTH_PASSWORD',
        'prod',
      );
    });

    it('should return empty object when no services have databases', async () => {
      const services = [
        { name: 'frontend', hasDatabase: false },
        { name: 'gateway', hasDatabase: false },
      ];

      const result = await fetchDbPasswordsFromSecretManager('prod', services);

      expect(result).toEqual({});
      expect(mockFetchSecret).not.toHaveBeenCalled();
    });

    it('should log loading message for each fetch', async () => {
      mockFetchSecret.mockReturnValue('password');

      const services = [{ name: 'auth-service', hasDatabase: true }];

      await fetchDbPasswordsFromSecretManager('prod', services);

      expect(mocks.logger.loading).toHaveBeenCalledWith(
        expect.stringContaining('DB_AUTH_PASSWORD'),
      );
    });
  });

  describe('missing passwords', () => {
    it('should throw CliError when password is missing', async () => {
      mockFetchSecret.mockReturnValue(null);

      const services = [{ name: 'auth-service', hasDatabase: true }];

      await expect(
        fetchDbPasswordsFromSecretManager('prod', services),
      ).rejects.toThrow(mocks.CliError);
    });

    it('should include all missing secrets in error message', async () => {
      mockFetchSecret.mockReturnValue(null);

      const services = [
        { name: 'auth-service', hasDatabase: true },
        { name: 'offers-service', hasDatabase: true },
      ];

      try {
        await fetchDbPasswordsFromSecretManager('prod', services);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('DB_AUTH_PASSWORD');
        expect((error as Error).message).toContain('DB_OFFERS_PASSWORD');
      }
    });

    it('should throw for partially missing passwords', async () => {
      mockFetchSecret
        .mockReturnValueOnce('auth-pass')
        .mockReturnValueOnce(null);

      const services = [
        { name: 'auth-service', hasDatabase: true },
        { name: 'offers-service', hasDatabase: true },
      ];

      try {
        await fetchDbPasswordsFromSecretManager('prod', services);
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('DB_OFFERS_PASSWORD');
        expect((error as Error).message).not.toContain('DB_AUTH_PASSWORD');
      }
    });

    it('should include hint about pushing secrets', async () => {
      mockFetchSecret.mockReturnValue(null);

      const services = [{ name: 'auth-service', hasDatabase: true }];

      try {
        await fetchDbPasswordsFromSecretManager('dev', services);
        expect.fail('Should have thrown');
      } catch (error) {
        // CliError includes hint in the error
        expect((error as Error).message).toContain(
          'Missing database passwords',
        );
      }
    });
  });
});
