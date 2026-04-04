import { describe, it, expect } from '@rstest/core';
import { generateInfrastructureSchema } from './generate-infrastructure-schema';
import {
  VALID_CPU_VALUES_GCP,
  VALID_CPU_VALUES_AWS,
  VALID_CPU_VALUES_AZURE,
  VALID_MEMORY_VALUES_GCP,
  VALID_MEMORY_VALUES_AWS,
  VALID_MEMORY_VALUES_AZURE,
  VALID_DATABASE_TIERS_GCP,
  VALID_DATABASE_TIERS_AWS,
  VALID_DATABASE_TIERS_AZURE,
  VALID_REDIS_TIERS_GCP,
  VALID_REDIS_TIERS_AWS,
  VALID_REDIS_TIERS_AZURE,
  VALID_SERVICE_TYPES_GCP,
  VALID_SERVICE_TYPES_AWS,
  VALID_SERVICE_TYPES_AZURE,
  VALID_APP_SERVICE_SKUS,
} from '../../constants';

describe('generateInfrastructureSchema', () => {
  it('should return valid JSON string', () => {
    const result = generateInfrastructureSchema();
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should have correct JSON schema version', () => {
    const result = JSON.parse(generateInfrastructureSchema());
    expect(result.$schema).toBe('http://json-schema.org/draft-07/schema#');
  });

  it('should have title and description', () => {
    const result = JSON.parse(generateInfrastructureSchema());
    expect(result.title).toContain('tsdevstack');
    expect(result.description).toBeDefined();
  });

  it('should require version field', () => {
    const result = JSON.parse(generateInfrastructureSchema());
    expect(result.required).toContain('version');
  });

  describe('ServiceOverride definition', () => {
    it('should include cpu enum from GCP constants (default)', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const cpuEnum = result.definitions.ServiceOverride.properties.cpu.enum;
      expect(cpuEnum).toEqual([...VALID_CPU_VALUES_GCP]);
    });

    it('should include memory enum from GCP constants (default)', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const memoryEnum =
        result.definitions.ServiceOverride.properties.memory.enum;
      expect(memoryEnum).toEqual([...VALID_MEMORY_VALUES_GCP]);
    });

    it('should have minInstances and maxInstances constraints', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const serviceOverride = result.definitions.ServiceOverride.properties;
      expect(serviceOverride.minInstances.minimum).toBeDefined();
      expect(serviceOverride.minInstances.maximum).toBeDefined();
      expect(serviceOverride.maxInstances.minimum).toBeDefined();
      expect(serviceOverride.maxInstances.maximum).toBeDefined();
    });

    it('should have timeout pattern for seconds', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const timeout = result.definitions.ServiceOverride.properties.timeout;
      expect(timeout.pattern).toBe('^[0-9]+s$');
    });
  });

  describe('DatabaseOverride definition', () => {
    it('should include tier enum from constants (defaults to GCP)', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const tierEnum = result.definitions.DatabaseOverride.properties.tier.enum;
      expect(tierEnum).toEqual(
        expect.arrayContaining([...VALID_DATABASE_TIERS_GCP]),
      );
    });

    it('should have diskSize constraints', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const diskSize = result.definitions.DatabaseOverride.properties.diskSize;
      expect(diskSize.minimum).toBeDefined();
      expect(diskSize.maximum).toBeDefined();
    });

    it('should have ha and backup boolean fields', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const db = result.definitions.DatabaseOverride.properties;
      expect(db.ha.type).toBe('boolean');
      expect(db.backup.type).toBe('boolean');
    });
  });

  describe('RedisOverride definition', () => {
    it('should include tier enum from constants (defaults to GCP)', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const tierEnum = result.definitions.RedisOverride.properties.tier.enum;
      expect(tierEnum).toEqual(
        expect.arrayContaining([...VALID_REDIS_TIERS_GCP]),
      );
    });

    it('should have memoryGb constraints', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const memoryGb = result.definitions.RedisOverride.properties.memoryGb;
      expect(memoryGb.minimum).toBeDefined();
      expect(memoryGb.maximum).toBeDefined();
    });
  });

  describe('KongOverride definition', () => {
    it('should have instance constraints for GCP (default)', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const kong = result.definitions.KongOverride.properties;
      expect(kong.minInstances).toBeDefined();
      expect(kong.maxInstances).toBeDefined();
    });

    it('should have cpu and memory enums for GCP (default)', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const kong = result.definitions.KongOverride.properties;
      expect(kong.cpu.enum).toBeDefined();
      expect(kong.memory.enum).toBeDefined();
    });

    it('should only have maxUploadSize for Azure (Kong uses App Service)', () => {
      const result = JSON.parse(generateInfrastructureSchema('azure'));
      const kong = result.definitions.KongOverride.properties;
      expect(Object.keys(kong)).toEqual(['maxUploadSize']);
    });

    it('should reject additional properties for Azure', () => {
      const result = JSON.parse(generateInfrastructureSchema('azure'));
      const kong = result.definitions.KongOverride;
      expect(kong.additionalProperties).toBe(false);
    });
  });

  describe('LoadBalancerOverride definition', () => {
    it('should have apiDomain field', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const lb = result.definitions.LoadBalancerOverride.properties;
      expect(lb.apiDomain).toBeDefined();
      expect(lb.apiDomain.type).toBe('string');
    });

    it('should have redirectDomains array', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const lb = result.definitions.LoadBalancerOverride.properties;
      expect(lb.redirectDomains).toBeDefined();
      expect(lb.redirectDomains.type).toBe('array');
    });
  });

  describe('EnvironmentConfig definition', () => {
    it('should reference all config types', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const envConfig = result.definitions.EnvironmentConfig.properties;
      expect(envConfig.database).toBeDefined();
      expect(envConfig.redis).toBeDefined();
      expect(envConfig.kong).toBeDefined();
      expect(envConfig.loadBalancer).toBeDefined();
      expect(envConfig.accessControl).toBeDefined();
      expect(envConfig.security).toBeDefined();
      expect(envConfig.scheduledJobs).toBeDefined();
    });

    it('should allow service names via additionalProperties', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const envConfig = result.definitions.EnvironmentConfig;
      expect(envConfig.additionalProperties).toBeDefined();
      expect(envConfig.additionalProperties.$ref).toBe(
        '#/definitions/ServiceOverride',
      );
    });
  });

  describe('ScheduledJobConfig definition', () => {
    it('should require name, schedule, targetService, endpoint', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const job = result.definitions.ScheduledJobConfig;
      expect(job.required).toEqual(
        expect.arrayContaining([
          'name',
          'schedule',
          'targetService',
          'endpoint',
        ]),
      );
    });

    it('should have method enum', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const method = result.definitions.ScheduledJobConfig.properties.method;
      expect(method.enum).toContain('GET');
      expect(method.enum).toContain('POST');
    });
  });

  describe('AccessControlOverride definition', () => {
    it('should have protected and noIndex boolean fields', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const ac = result.definitions.AccessControlOverride.properties;
      expect(ac.protected.type).toBe('boolean');
      expect(ac.noIndex.type).toBe('boolean');
    });
  });

  describe('SecurityOverride definition', () => {
    it('should have waf property', () => {
      const result = JSON.parse(generateInfrastructureSchema());
      const security = result.definitions.SecurityOverride.properties;
      expect(security.waf).toBeDefined();
    });
  });

  describe('WAF schema (provider-aware)', () => {
    it('should show GCP customRules with CEL expression for GCP', () => {
      const result = JSON.parse(generateInfrastructureSchema('gcp'));
      const waf = result.definitions.WafOverride.properties;
      expect(waf.customRules).toBeDefined();
      expect(waf.rateLimit).toBeDefined();
      expect(waf.awsCustomRules).toBeUndefined();
      expect(waf.azureCustomRules).toBeUndefined();

      const rule = result.definitions.WafCustomRule;
      expect(rule.required).toEqual(
        expect.arrayContaining(['name', 'priority', 'action', 'expression']),
      );
      expect(rule.properties.action.enum).toContain('allow');
      expect(rule.properties.action.enum).toContain('deny(403)');
      expect(rule.properties.action.enum).toContain('throttle');
    });

    it('should show AWS awsCustomRules with byte match for AWS', () => {
      const result = JSON.parse(generateInfrastructureSchema('aws'));
      const waf = result.definitions.WafOverride.properties;
      expect(waf.awsCustomRules).toBeDefined();
      expect(waf.rateLimit).toBeDefined();
      expect(waf.customRules).toBeUndefined();
      expect(waf.azureCustomRules).toBeUndefined();

      const rule = result.definitions.AwsWafCustomRule;
      expect(rule.required).toEqual(
        expect.arrayContaining(['name', 'priority', 'action', 'matchType']),
      );
      expect(rule.properties.matchType.enum).toContain('byte_match');
      expect(rule.properties.matchType.enum).toContain('rate_based');
      expect(rule.properties.matchType.enum).toContain('geo_match');

      expect(result.definitions.AwsWafByteMatchConfig).toBeDefined();
      expect(result.definitions.AwsWafGeoMatchConfig).toBeDefined();
    });

    it('should show Azure azureCustomRules with match conditions for Azure', () => {
      const result = JSON.parse(generateInfrastructureSchema('azure'));
      const waf = result.definitions.WafOverride.properties;
      expect(waf.azureCustomRules).toBeDefined();
      expect(waf.rateLimit).toBeDefined();
      expect(waf.customRules).toBeUndefined();
      expect(waf.awsCustomRules).toBeUndefined();

      const rule = result.definitions.AzureWafCustomRule;
      expect(rule.required).toEqual(
        expect.arrayContaining([
          'name',
          'type',
          'priority',
          'action',
          'matchConditions',
        ]),
      );
      expect(rule.properties.type.enum).toContain('MatchRule');
      expect(rule.properties.type.enum).toContain('RateLimitRule');
      expect(rule.properties.action.enum).toContain('Block');
      expect(rule.properties.action.enum).toContain('Allow');
      expect(rule.properties.action.enum).toContain('Log');

      expect(result.definitions.AzureWafMatchCondition).toBeDefined();
    });

    it('should include WafRateLimitConfig for all providers', () => {
      for (const provider of ['gcp', 'aws', 'azure'] as const) {
        const result = JSON.parse(generateInfrastructureSchema(provider));
        expect(result.definitions.WafRateLimitConfig).toBeDefined();
        expect(
          result.definitions.WafRateLimitConfig.properties.count,
        ).toBeDefined();
        expect(
          result.definitions.WafRateLimitConfig.properties.intervalSec,
        ).toBeDefined();
      }
    });
  });

  describe('provider-specific schema', () => {
    describe('GCP provider', () => {
      it('should use GCP database tiers', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        const tierEnum =
          result.definitions.DatabaseOverride.properties.tier.enum;
        expect(tierEnum).toEqual([...VALID_DATABASE_TIERS_GCP]);
      });

      it('should use GCP redis tiers', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        const tierEnum = result.definitions.RedisOverride.properties.tier.enum;
        expect(tierEnum).toEqual([...VALID_REDIS_TIERS_GCP]);
      });

      it('should use GCP service types', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        const typeEnum =
          result.definitions.ServiceOverride.properties.type.enum;
        expect(typeEnum).toEqual([...VALID_SERVICE_TYPES_GCP]);
      });

      it('should use GCP cpu values', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        const cpuEnum = result.definitions.ServiceOverride.properties.cpu.enum;
        expect(cpuEnum).toEqual([...VALID_CPU_VALUES_GCP]);
      });

      it('should use GCP memory values', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        const memoryEnum =
          result.definitions.ServiceOverride.properties.memory.enum;
        expect(memoryEnum).toEqual([...VALID_MEMORY_VALUES_GCP]);
      });

      it('should have GCP-specific descriptions', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        expect(result.definitions.DatabaseOverride.description).toContain(
          'Cloud SQL',
        );
        expect(result.definitions.RedisOverride.description).toContain(
          'Memorystore',
        );
        expect(result.definitions.ServiceOverride.description).toContain(
          'Cloud Run',
        );
      });

      it('should NOT include AppServiceOverride definition', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        expect(result.definitions.AppServiceOverride).toBeUndefined();
      });

      it('should NOT include appService in EnvironmentConfig', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        const envProps = result.definitions.EnvironmentConfig.properties;
        expect(envProps.appService).toBeUndefined();
      });

      it('should NOT include frontdoorPremium in EnvironmentConfig', () => {
        const result = JSON.parse(generateInfrastructureSchema('gcp'));
        const envProps = result.definitions.EnvironmentConfig.properties;
        expect(envProps.frontdoorPremium).toBeUndefined();
      });
    });

    describe('AWS provider', () => {
      it('should use AWS database tiers', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        const tierEnum =
          result.definitions.DatabaseOverride.properties.tier.enum;
        expect(tierEnum).toEqual([...VALID_DATABASE_TIERS_AWS]);
      });

      it('should use AWS redis tiers', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        const tierEnum = result.definitions.RedisOverride.properties.tier.enum;
        expect(tierEnum).toEqual([...VALID_REDIS_TIERS_AWS]);
      });

      it('should use AWS service types', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        const typeEnum =
          result.definitions.ServiceOverride.properties.type.enum;
        expect(typeEnum).toEqual([...VALID_SERVICE_TYPES_AWS]);
      });

      it('should use AWS cpu values', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        const cpuEnum = result.definitions.ServiceOverride.properties.cpu.enum;
        expect(cpuEnum).toEqual([...VALID_CPU_VALUES_AWS]);
      });

      it('should use AWS memory values', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        const memoryEnum =
          result.definitions.ServiceOverride.properties.memory.enum;
        expect(memoryEnum).toEqual([...VALID_MEMORY_VALUES_AWS]);
      });

      it('should have AWS-specific descriptions', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        expect(result.definitions.DatabaseOverride.description).toContain(
          'RDS',
        );
        expect(result.definitions.RedisOverride.description).toContain(
          'ElastiCache',
        );
        expect(result.definitions.ServiceOverride.description).toContain('ECS');
      });

      it('should NOT include AppServiceOverride definition', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        expect(result.definitions.AppServiceOverride).toBeUndefined();
      });

      it('should NOT include appService in EnvironmentConfig', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        const envProps = result.definitions.EnvironmentConfig.properties;
        expect(envProps.appService).toBeUndefined();
      });

      it('should NOT include frontdoorPremium in EnvironmentConfig', () => {
        const result = JSON.parse(generateInfrastructureSchema('aws'));
        const envProps = result.definitions.EnvironmentConfig.properties;
        expect(envProps.frontdoorPremium).toBeUndefined();
      });
    });

    describe('Azure provider', () => {
      it('should use Azure database tiers', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        const tierEnum =
          result.definitions.DatabaseOverride.properties.tier.enum;
        expect(tierEnum).toEqual([...VALID_DATABASE_TIERS_AZURE]);
      });

      it('should use Azure redis tiers', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        const tierEnum = result.definitions.RedisOverride.properties.tier.enum;
        expect(tierEnum).toEqual([...VALID_REDIS_TIERS_AZURE]);
      });

      it('should use Azure service types', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        const typeEnum =
          result.definitions.ServiceOverride.properties.type.enum;
        expect(typeEnum).toEqual([...VALID_SERVICE_TYPES_AZURE]);
      });

      it('should use Azure cpu values', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        const cpuEnum = result.definitions.ServiceOverride.properties.cpu.enum;
        expect(cpuEnum).toEqual([...VALID_CPU_VALUES_AZURE]);
      });

      it('should use Azure memory values', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        const memoryEnum =
          result.definitions.ServiceOverride.properties.memory.enum;
        expect(memoryEnum).toEqual([...VALID_MEMORY_VALUES_AZURE]);
      });

      it('should have Azure-specific descriptions', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        expect(result.definitions.DatabaseOverride.description).toContain(
          'Flexible Server',
        );
        expect(result.definitions.RedisOverride.description).toContain(
          'Azure Managed Redis',
        );
        expect(result.definitions.ServiceOverride.description).toContain(
          'Container Apps',
        );
      });

      it('should include AppServiceOverride definition', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        expect(result.definitions.AppServiceOverride).toBeDefined();
        const appService = result.definitions.AppServiceOverride;
        expect(appService.type).toBe('object');
        expect(appService.additionalProperties).toBe(false);
      });

      it('should have kongSku and nextjsSku with App Service SKU enums', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        const props = result.definitions.AppServiceOverride.properties;
        expect(props.kongSku.enum).toEqual([...VALID_APP_SERVICE_SKUS]);
        expect(props.nextjsSku.enum).toEqual([...VALID_APP_SERVICE_SKUS]);
      });

      it('should include appService in EnvironmentConfig properties', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        const envProps = result.definitions.EnvironmentConfig.properties;
        expect(envProps.appService).toBeDefined();
        expect(envProps.appService.$ref).toBe(
          '#/definitions/AppServiceOverride',
        );
      });

      it('should have Kong description mentioning App Service', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        expect(result.definitions.KongOverride.description).toContain(
          'App Service',
        );
      });

      it('should include frontdoorPremium in EnvironmentConfig properties', () => {
        const result = JSON.parse(generateInfrastructureSchema('azure'));
        const envProps = result.definitions.EnvironmentConfig.properties;
        expect(envProps.frontdoorPremium).toBeDefined();
        expect(envProps.frontdoorPremium.type).toBe('boolean');
      });
    });

    it('should default to GCP when no provider specified', () => {
      const defaultResult = JSON.parse(generateInfrastructureSchema());
      const gcpResult = JSON.parse(generateInfrastructureSchema('gcp'));
      expect(defaultResult).toEqual(gcpResult);
    });
  });
});
