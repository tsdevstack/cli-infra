import { describe, it, expect } from '@rstest/core';
import { addRedisTlsToKongConfig } from './add-redis-tls-to-kong-config';
import type { KongTemplate } from '@tsdevstack/cli/plugin';

describe('addRedisTlsToKongConfig', () => {
  describe('Global plugins', () => {
    it('should add verified TLS to rate-limiting plugin redis config', () => {
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
      expect(redis.ssl_verify).toBe(true);
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

  describe('Service plugins', () => {
    const redisBlock = {
      host: '${REDIS_HOST}',
      port: '${REDIS_PORT}',
      password: '${REDIS_PASSWORD}',
      database: 0,
      timeout: 2000,
    };

    it('should add TLS to the per-IP ceiling and the API key plugin of partner services', () => {
      const config: KongTemplate = {
        _format_version: '3.0',
        services: [
          {
            name: 'offers-service-partner',
            url: '${OFFERS_SERVICE_URL}',
            routes: [],
            plugins: [
              {
                name: 'rate-limiting',
                config: {
                  minute: 600,
                  limit_by: 'ip',
                  policy: 'redis',
                  hide_client_headers: false,
                  redis: { ...redisBlock },
                },
              },
              {
                name: 'tsdevstack-api-key',
                config: {
                  key_names: ['x-api-key'],
                  redis: { ...redisBlock },
                  default_limits: { minute: 100 },
                },
              },
              { name: 'tsdevstack-api-prefix', config: { prefix: '/api' } },
            ],
          },
        ],
      };

      const result = addRedisTlsToKongConfig(config);
      const plugins = result.services[0].plugins!;

      for (const plugin of plugins.slice(0, 2)) {
        expect(plugin.config.redis).toEqual({
          ...redisBlock,
          ssl: true,
          ssl_verify: true,
          server_name: redisBlock.host,
        });
      }
      expect(plugins[2]).toEqual({
        name: 'tsdevstack-api-prefix',
        config: { prefix: '/api' },
      });
      // Input unchanged
      expect(
        (config.services[0].plugins![1].config.redis as Record<string, unknown>)
          .ssl,
      ).toBeUndefined();
    });

    it('should keep services without plugins as they are', () => {
      const service = {
        name: 'offers-service-public',
        url: '${OFFERS_SERVICE_URL}',
        routes: [],
      };
      const result = addRedisTlsToKongConfig({
        _format_version: '3.0',
        services: [service],
      });

      expect(result.services[0]).toBe(service);
    });
  });

  describe('Consumer plugins', () => {
    it('should add verified TLS to consumer rate-limiting plugin', () => {
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
      expect(redis.ssl_verify).toBe(true);
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
