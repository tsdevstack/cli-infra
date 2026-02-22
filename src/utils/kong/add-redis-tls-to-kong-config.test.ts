import { describe, it, expect } from '@rstest/core';
import { addRedisTlsToKongConfig } from './add-redis-tls-to-kong-config';
import type { KongTemplate } from 'tsdevstack/plugin';

describe('addRedisTlsToKongConfig', () => {
  describe('Global plugins', () => {
    it('should add ssl and ssl_verify to rate-limiting plugin redis config', () => {
      const config: KongTemplate = {
        _format_version: '3.0',
        services: [],
        plugins: [
          {
            name: 'rate-limiting',
            config: {
              minute: 100,
              policy: 'redis',
              redis: {
                host: '${REDIS_HOST}',
                port: '${REDIS_PORT}',
                password: '${REDIS_PASSWORD}',
                database: 0,
                timeout: 2000,
              },
            },
          },
        ],
      };

      const result = addRedisTlsToKongConfig(config);
      const rateLimiting = result.plugins![0];
      const redis = rateLimiting.config.redis as Record<string, unknown>;

      expect(redis.ssl).toBe(true);
      expect(redis.ssl_verify).toBe(false);
      expect(redis.host).toBe('${REDIS_HOST}');
      expect(redis.port).toBe('${REDIS_PORT}');
    });

    it('should not modify non-rate-limiting plugins', () => {
      const config: KongTemplate = {
        _format_version: '3.0',
        services: [],
        plugins: [
          {
            name: 'cors',
            config: {
              origins: ['*'],
            },
          },
        ],
      };

      const result = addRedisTlsToKongConfig(config);

      expect(result.plugins![0]).toEqual(config.plugins![0]);
    });

    it('should handle rate-limiting plugin without redis config', () => {
      const config: KongTemplate = {
        _format_version: '3.0',
        services: [],
        plugins: [
          {
            name: 'rate-limiting',
            config: {
              minute: 100,
              policy: 'local',
            },
          },
        ],
      };

      const result = addRedisTlsToKongConfig(config);

      expect(result.plugins![0]).toEqual(config.plugins![0]);
    });
  });

  describe('Consumer plugins', () => {
    it('should add ssl and ssl_verify to consumer rate-limiting plugin', () => {
      const config: KongTemplate = {
        _format_version: '3.0',
        services: [],
        consumers: [
          {
            username: 'test-partner',
            plugins: [
              {
                name: 'rate-limiting',
                config: {
                  minute: 50,
                  policy: 'redis',
                  redis: {
                    host: '${REDIS_HOST}',
                    port: '${REDIS_PORT}',
                    password: '${REDIS_PASSWORD}',
                    database: 0,
                    timeout: 2000,
                  },
                },
              },
            ],
          },
        ],
      };

      const result = addRedisTlsToKongConfig(config);
      const consumer = result.consumers![0];
      const rateLimiting = consumer.plugins![0];
      const redis = rateLimiting.config.redis as Record<string, unknown>;

      expect(redis.ssl).toBe(true);
      expect(redis.ssl_verify).toBe(false);
    });

    it('should not modify consumers without plugins', () => {
      const config: KongTemplate = {
        _format_version: '3.0',
        services: [],
        consumers: [
          {
            username: 'test-partner',
          },
        ],
      };

      const result = addRedisTlsToKongConfig(config);

      expect(result.consumers![0]).toEqual(config.consumers![0]);
    });
  });

  describe('No plugins or consumers', () => {
    it('should handle config with no plugins or consumers', () => {
      const config: KongTemplate = {
        _format_version: '3.0',
        services: [],
      };

      const result = addRedisTlsToKongConfig(config);

      expect(result.plugins).toBeUndefined();
      expect(result.consumers).toBeUndefined();
    });
  });
});
