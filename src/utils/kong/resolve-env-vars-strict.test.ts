import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

import { resolveEnvVarsStrict } from './resolve-env-vars-strict';

describe('resolveEnvVarsStrict', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('string values', () => {
    it('should resolve single placeholder', () => {
      const secrets = { DATABASE_URL: 'postgres://localhost:5432/db' };
      const result = resolveEnvVarsStrict('${DATABASE_URL}', secrets);
      expect(result).toBe('postgres://localhost:5432/db');
    });

    it('should resolve multiple placeholders in one string', () => {
      const secrets = { HOST: 'localhost', PORT: '5432' };
      const result = resolveEnvVarsStrict('${HOST}:${PORT}', secrets);
      expect(result).toBe('localhost:5432');
    });

    it('should return string as-is if no placeholders', () => {
      const result = resolveEnvVarsStrict('no placeholders', {});
      expect(result).toBe('no placeholders');
    });

    it('should throw CliError when secret is missing', () => {
      expect(() => resolveEnvVarsStrict('${MISSING_VAR}', {})).toThrow(
        mocks.CliError,
      );
    });

    it('should include secret name in error message', () => {
      try {
        resolveEnvVarsStrict('${MY_SECRET}', {});
        expect.fail('Should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('MY_SECRET');
      }
    });
  });

  describe('object values', () => {
    it('should resolve placeholders in simple object', () => {
      const secrets = { API_KEY: 'secret123', URL: 'https://api.example.com' };
      const obj = { key: '${API_KEY}', url: '${URL}' };
      const result = resolveEnvVarsStrict(obj, secrets);
      expect(result).toEqual({
        key: 'secret123',
        url: 'https://api.example.com',
      });
    });

    it('should resolve placeholders in nested object', () => {
      const secrets = { DB_HOST: 'localhost', DB_PASS: 'password123' };
      const obj = {
        database: {
          host: '${DB_HOST}',
          credentials: {
            password: '${DB_PASS}',
          },
        },
      };
      const result = resolveEnvVarsStrict(obj, secrets);
      expect(result).toEqual({
        database: {
          host: 'localhost',
          credentials: {
            password: 'password123',
          },
        },
      });
    });

    it('should handle empty object', () => {
      const result = resolveEnvVarsStrict({}, {});
      expect(result).toEqual({});
    });
  });

  describe('array values', () => {
    it('should resolve placeholders in array of strings', () => {
      const secrets = { VAR1: 'value1', VAR2: 'value2' };
      const arr = ['${VAR1}', '${VAR2}', 'static'];
      const result = resolveEnvVarsStrict(arr, secrets);
      expect(result).toEqual(['value1', 'value2', 'static']);
    });

    it('should resolve placeholders in array of objects', () => {
      const secrets = { KEY: 'resolved' };
      const arr = [{ key: '${KEY}' }, { key: 'static' }];
      const result = resolveEnvVarsStrict(arr, secrets);
      expect(result).toEqual([{ key: 'resolved' }, { key: 'static' }]);
    });

    it('should handle empty array', () => {
      const result = resolveEnvVarsStrict([], {});
      expect(result).toEqual([]);
    });
  });

  describe('primitive values', () => {
    it('should return null as-is', () => {
      const result = resolveEnvVarsStrict(null, {});
      expect(result).toBeNull();
    });

    it('should return numbers as-is', () => {
      const result = resolveEnvVarsStrict(42, {});
      expect(result).toBe(42);
    });

    it('should return booleans as-is', () => {
      const result = resolveEnvVarsStrict(true, {});
      expect(result).toBe(true);
    });
  });

  describe('numeric string conversion', () => {
    it('should convert single placeholder with numeric value to integer', () => {
      const secrets = { REDIS_PORT: '6379' };
      const result = resolveEnvVarsStrict('${REDIS_PORT}', secrets);
      expect(result).toBe(6379);
      expect(typeof result).toBe('number');
    });

    it('should convert numeric placeholder in object to integer', () => {
      const secrets = { PORT: '3000', TIMEOUT: '5000' };
      const obj = { port: '${PORT}', timeout: '${TIMEOUT}' };
      const result = resolveEnvVarsStrict(obj, secrets);
      expect(result).toEqual({ port: 3000, timeout: 5000 });
    });

    it('should NOT convert embedded placeholders to numbers', () => {
      const secrets = { HOST: 'localhost', PORT: '3000' };
      const result = resolveEnvVarsStrict('${HOST}:${PORT}', secrets);
      expect(result).toBe('localhost:3000');
      expect(typeof result).toBe('string');
    });

    it('should NOT convert non-numeric single placeholder to number', () => {
      const secrets = { HOST: 'localhost' };
      const result = resolveEnvVarsStrict('${HOST}', secrets);
      expect(result).toBe('localhost');
      expect(typeof result).toBe('string');
    });

    it('should handle Redis config with port as number', () => {
      const secrets = {
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: '6379',
        REDIS_PASSWORD: 'secret',
      };
      const config = {
        redis: {
          host: '${REDIS_HOST}',
          port: '${REDIS_PORT}',
          password: '${REDIS_PASSWORD}',
        },
      };
      const result = resolveEnvVarsStrict(config, secrets);
      expect(result).toEqual({
        redis: {
          host: 'redis.internal',
          port: 6379,
          password: 'secret',
        },
      });
      expect(typeof (result as { redis: { port: number } }).redis.port).toBe(
        'number',
      );
    });
  });

  describe('complex Kong config', () => {
    it('should resolve all placeholders in Kong-like config', () => {
      const secrets = {
        AUTH_HOST: 'auth-service',
        AUTH_PORT: '3000',
        CLIENT_ID: 'my-client',
        CLIENT_SECRET: 'super-secret',
      };
      const config = {
        services: [
          {
            name: 'auth',
            url: 'http://${AUTH_HOST}:${AUTH_PORT}',
            plugins: [
              {
                name: 'oidc',
                config: {
                  client_id: '${CLIENT_ID}',
                  client_secret: '${CLIENT_SECRET}',
                },
              },
            ],
          },
        ],
      };
      const result = resolveEnvVarsStrict(config, secrets);
      expect(result).toEqual({
        services: [
          {
            name: 'auth',
            url: 'http://auth-service:3000',
            plugins: [
              {
                name: 'oidc',
                config: {
                  client_id: 'my-client',
                  client_secret: 'super-secret',
                },
              },
            ],
          },
        ],
      });
    });
  });

  describe('Kong runtime env var syntax', () => {
    it('should NOT resolve Kong double-brace env var syntax', () => {
      const secrets = { AUTH_SERVICE_URL: 'http://auth:8080' };
      const result = resolveEnvVarsStrict(
        '${{env "KONG_RUNTIME_DOMAIN"}}',
        secrets,
      );
      expect(result).toBe('${{env "KONG_RUNTIME_DOMAIN"}}');
    });

    it('should resolve single-brace but preserve double-brace', () => {
      const secrets = { AUTH_SERVICE_URL: 'http://auth:8080' };
      const config = {
        url: '${AUTH_SERVICE_URL}',
        target: '${{env "KONG_RUNTIME_DOMAIN"}}',
      };
      const result = resolveEnvVarsStrict(config, secrets);
      expect(result).toEqual({
        url: 'http://auth:8080',
        target: '${{env "KONG_RUNTIME_DOMAIN"}}',
      });
    });
  });
});
