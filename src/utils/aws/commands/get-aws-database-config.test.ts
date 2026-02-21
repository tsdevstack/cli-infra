import { describe, it, expect } from '@rstest/core';
import { getAWSDatabaseConfig } from './get-aws-database-config';

describe('getAWSDatabaseConfig', () => {
  const defaults = {
    tier: 'db.t3.micro',
    storageSizeGb: 20,
    deletionProtection: true,
    backup: true,
  };

  it('should return defaults when infraConfig is null', () => {
    const result = getAWSDatabaseConfig(null, 'dev');
    expect(result).toEqual(defaults);
  });

  it('should return defaults when environment not in config', () => {
    const result = getAWSDatabaseConfig({ staging: {} }, 'dev');
    expect(result).toEqual(defaults);
  });

  it('should return defaults when no database override', () => {
    const result = getAWSDatabaseConfig({ dev: { redis: {} } }, 'dev');
    expect(result).toEqual(defaults);
  });

  it('should merge overrides with defaults', () => {
    const config = {
      dev: {
        database: {
          tier: 'db.t3.large',
          storageSizeGb: 100,
        },
      },
    };

    const result = getAWSDatabaseConfig(config, 'dev');
    expect(result).toEqual({
      tier: 'db.t3.large',
      storageSizeGb: 100,
      deletionProtection: true,
      backup: true,
    });
  });

  it('should override all fields', () => {
    const config = {
      dev: {
        database: {
          tier: 'db.r6g.xlarge',
          storageSizeGb: 500,
          deletionProtection: false,
          backup: false,
        },
      },
    };

    const result = getAWSDatabaseConfig(config, 'dev');
    expect(result).toEqual({
      tier: 'db.r6g.xlarge',
      storageSizeGb: 500,
      deletionProtection: false,
      backup: false,
    });
  });

  it('should use correct environment', () => {
    const config = {
      dev: { database: { tier: 'db.t3.micro' } },
      prod: { database: { tier: 'db.r6g.xlarge' } },
    };

    const result = getAWSDatabaseConfig(config, 'prod');
    expect(result.tier).toBe('db.r6g.xlarge');
  });
});
