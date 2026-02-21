import { describe, it, expect } from '@rstest/core';
import { getAWSRedisConfig } from './get-aws-redis-config';

describe('getAWSRedisConfig', () => {
  const defaults = {
    tier: 'cache.t3.micro',
    highAvailability: false,
  };

  it('should return defaults when infraConfig is null', () => {
    const result = getAWSRedisConfig(null, 'dev');
    expect(result).toEqual(defaults);
  });

  it('should return defaults when environment not in config', () => {
    const result = getAWSRedisConfig({ staging: {} }, 'dev');
    expect(result).toEqual(defaults);
  });

  it('should return defaults when no redis override', () => {
    const result = getAWSRedisConfig({ dev: { database: {} } }, 'dev');
    expect(result).toEqual(defaults);
  });

  it('should merge overrides with defaults', () => {
    const config = {
      dev: {
        redis: {
          tier: 'cache.r6g.large',
        },
      },
    };

    const result = getAWSRedisConfig(config, 'dev');
    expect(result).toEqual({
      tier: 'cache.r6g.large',
      highAvailability: false,
    });
  });

  it('should override all fields', () => {
    const config = {
      prod: {
        redis: {
          tier: 'cache.r6g.xlarge',
          highAvailability: true,
        },
      },
    };

    const result = getAWSRedisConfig(config, 'prod');
    expect(result).toEqual({
      tier: 'cache.r6g.xlarge',
      highAvailability: true,
    });
  });

  it('should use correct environment', () => {
    const config = {
      dev: { redis: { highAvailability: false } },
      prod: { redis: { highAvailability: true } },
    };

    const result = getAWSRedisConfig(config, 'prod');
    expect(result.highAvailability).toBe(true);
  });
});
