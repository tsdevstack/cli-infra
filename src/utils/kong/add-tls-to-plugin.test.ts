import { describe, it, expect } from '@rstest/core';
import { addTlsToPlugin } from './add-tls-to-plugin';
import type { KongPlugin } from '@tsdevstack/cli/plugin';

describe('addTlsToPlugin', () => {
  it('should add ssl and ssl_verify to rate-limiting plugin redis config', () => {
    const plugin: KongPlugin = {
      name: 'rate-limiting',
      config: {
        minute: 100,
        policy: 'redis',
        redis: {
          host: 'redis.example.com',
          port: 6379,
          password: 'secret',
        },
      },
    };

    const result = addTlsToPlugin(plugin);
    const redis = result.config.redis as Record<string, unknown>;

    expect(redis.ssl).toBe(true);
    expect(redis.ssl_verify).toBe(false);
    expect(redis.host).toBe('redis.example.com');
  });

  it('should not modify non-rate-limiting plugins', () => {
    const plugin: KongPlugin = {
      name: 'cors',
      config: { origins: ['*'] },
    };

    const result = addTlsToPlugin(plugin);

    expect(result).toEqual(plugin);
  });

  it('should not modify rate-limiting plugin without redis config', () => {
    const plugin: KongPlugin = {
      name: 'rate-limiting',
      config: { minute: 100, policy: 'local' },
    };

    const result = addTlsToPlugin(plugin);

    expect(result).toEqual(plugin);
  });

  it('should add ssl and ssl_verify to the tsdevstack-api-key redis config', () => {
    const plugin: KongPlugin = {
      name: 'tsdevstack-api-key',
      config: {
        key_names: ['x-api-key'],
        redis: {
          host: '${REDIS_HOST}',
          port: '${REDIS_PORT}',
          password: '${REDIS_PASSWORD}',
          database: 0,
          timeout: 2000,
        },
        default_limits: { minute: 100 },
      },
    };

    const result = addTlsToPlugin(plugin);

    expect(result.config).toEqual({
      key_names: ['x-api-key'],
      redis: {
        host: '${REDIS_HOST}',
        port: '${REDIS_PORT}',
        password: '${REDIS_PASSWORD}',
        database: 0,
        timeout: 2000,
        ssl: true,
        ssl_verify: false,
      },
      default_limits: { minute: 100 },
    });
    // The input is not changed
    expect(
      (plugin.config.redis as Record<string, unknown>).ssl,
    ).toBeUndefined();
  });

  it('should not modify other plugins with a redis block', () => {
    const plugin: KongPlugin = {
      name: 'my-plugin',
      config: { redis: { host: 'h' } },
    };

    expect(addTlsToPlugin(plugin)).toBe(plugin);
  });
});
