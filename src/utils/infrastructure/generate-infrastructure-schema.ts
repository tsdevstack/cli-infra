/**
 * Generate Infrastructure Schema
 *
 * Dynamically generates JSON schema for infrastructure.json
 * based on actual constants and constraints.
 */

import {
  VALIDATION_CONSTRAINTS,
  AZURE_POSTGRES_SERVER_NAME_CONSTRAINTS,
  REDIS_CONSTRAINTS,
} from '../../constants';
import {
  getProviderSchemaConfig,
  type SchemaProvider,
} from './get-provider-schema-config';

/**
 * Build WAF-related schema definitions based on provider
 */
function buildWafSchemaDefinitions(
  provider: SchemaProvider,
): Record<string, unknown> {
  const rateLimitConfig = {
    WafRateLimitConfig: {
      type: 'object',
      description:
        'Global rate limit configuration (applied across all providers)',
      required: ['count', 'intervalSec'],
      properties: {
        count: {
          type: 'integer',
          minimum: 1,
          description: 'Requests allowed per interval',
        },
        intervalSec: {
          type: 'integer',
          minimum: 1,
          maximum: 3600,
          description: 'Interval in seconds',
        },
      },
      additionalProperties: false,
    },
  };

  if (provider === 'gcp') {
    return {
      WafOverride: {
        type: 'object',
        description: 'WAF configuration (GCP Cloud Armor)',
        properties: {
          customRules: {
            type: 'array',
            description: 'Custom WAF rules for Cloud Armor',
            items: { $ref: '#/definitions/WafCustomRule' },
          },
          rateLimit: { $ref: '#/definitions/WafRateLimitConfig' },
        },
        additionalProperties: false,
      },
      WafCustomRule: {
        type: 'object',
        description: 'Custom Cloud Armor WAF rule (CEL expression)',
        required: ['name', 'priority', 'action', 'expression'],
        properties: {
          name: {
            type: 'string',
            description: 'Unique rule identifier',
          },
          priority: {
            type: 'integer',
            minimum: 1,
            maximum: 2147483646,
            description: 'Rule priority (use 800-899 for custom rules)',
          },
          action: {
            type: 'string',
            enum: ['allow', 'deny(403)', 'deny(404)', 'deny(429)', 'throttle'],
            description: 'Action to take when rule matches',
          },
          expression: {
            type: 'string',
            description: 'CEL expression (validated by Terraform/GCP)',
          },
          description: {
            type: 'string',
            description: 'Human-readable description',
          },
          rateLimit: { $ref: '#/definitions/WafRateLimitConfig' },
        },
        additionalProperties: false,
      },
      ...rateLimitConfig,
    };
  }

  if (provider === 'aws') {
    return {
      WafOverride: {
        type: 'object',
        description: 'WAF configuration (AWS WAF v2)',
        properties: {
          awsCustomRules: {
            type: 'array',
            description: 'Custom WAF rules for AWS WAF v2',
            items: { $ref: '#/definitions/AwsWafCustomRule' },
          },
          rateLimit: { $ref: '#/definitions/WafRateLimitConfig' },
        },
        additionalProperties: false,
      },
      AwsWafCustomRule: {
        type: 'object',
        description: 'Custom AWS WAF v2 rule',
        required: ['name', 'priority', 'action', 'matchType'],
        properties: {
          name: {
            type: 'string',
            description: 'Unique rule identifier',
          },
          priority: {
            type: 'integer',
            minimum: 100,
            maximum: 899,
            description: 'Rule priority (100-899, managed rules use 1-99)',
          },
          action: {
            type: 'string',
            enum: ['block', 'allow', 'count'],
            description: 'Action when rule matches',
          },
          description: {
            type: 'string',
            description: 'Human-readable description',
          },
          matchType: {
            type: 'string',
            enum: ['byte_match', 'rate_based', 'geo_match'],
            description: 'Rule type',
          },
          byteMatch: { $ref: '#/definitions/AwsWafByteMatchConfig' },
          geoMatch: { $ref: '#/definitions/AwsWafGeoMatchConfig' },
          rateLimit: {
            type: 'integer',
            minimum: 100,
            description:
              'Requests per 5-minute window (required when matchType is rate_based)',
          },
        },
        additionalProperties: false,
      },
      AwsWafByteMatchConfig: {
        type: 'object',
        description: 'AWS WAF byte match configuration',
        required: ['searchString', 'fieldToMatch', 'positionalConstraint'],
        properties: {
          searchString: {
            type: 'string',
            description: 'String to search for',
          },
          fieldToMatch: {
            type: 'string',
            enum: ['uri_path', 'query_string', 'body', 'header'],
            description: 'Part of the request to inspect',
          },
          headerName: {
            type: 'string',
            description: 'Header name (required when fieldToMatch is header)',
          },
          positionalConstraint: {
            type: 'string',
            enum: ['CONTAINS', 'STARTS_WITH', 'ENDS_WITH', 'EXACTLY'],
            description: 'How to match the string',
          },
        },
        additionalProperties: false,
      },
      AwsWafGeoMatchConfig: {
        type: 'object',
        description: 'AWS WAF geo match configuration',
        required: ['countryCodes'],
        properties: {
          countryCodes: {
            type: 'array',
            description:
              'ISO 3166-1 alpha-2 country codes (e.g., ["US", "CA"])',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
      ...rateLimitConfig,
    };
  }

  // Azure
  return {
    WafOverride: {
      type: 'object',
      description: 'WAF configuration (Azure Front Door)',
      properties: {
        azureCustomRules: {
          type: 'array',
          description: 'Custom WAF rules for Azure Front Door',
          items: { $ref: '#/definitions/AzureWafCustomRule' },
        },
        rateLimit: { $ref: '#/definitions/WafRateLimitConfig' },
      },
      additionalProperties: false,
    },
    AzureWafCustomRule: {
      type: 'object',
      description: 'Custom Azure Front Door WAF rule',
      required: ['name', 'type', 'priority', 'action', 'matchConditions'],
      properties: {
        name: {
          type: 'string',
          description: 'Unique rule name (alphanumeric only)',
        },
        type: {
          type: 'string',
          enum: ['MatchRule', 'RateLimitRule'],
          description: 'Rule type',
        },
        priority: {
          type: 'integer',
          minimum: 1000,
          description:
            'Rule priority (use 1000+ to avoid conflicts with framework rules)',
        },
        action: {
          type: 'string',
          enum: ['Block', 'Allow', 'Log'],
          description: 'Action when rule matches',
        },
        matchConditions: {
          type: 'array',
          description: 'Match conditions (all must match)',
          items: { $ref: '#/definitions/AzureWafMatchCondition' },
        },
        description: {
          type: 'string',
          description: 'Human-readable description',
        },
        rateLimitDurationInMinutes: {
          type: 'integer',
          minimum: 1,
          description:
            'Rate limit duration in minutes (required for RateLimitRule)',
        },
        rateLimitThreshold: {
          type: 'integer',
          minimum: 1,
          description: 'Rate limit threshold (required for RateLimitRule)',
        },
      },
      additionalProperties: false,
    },
    AzureWafMatchCondition: {
      type: 'object',
      description: 'Azure Front Door WAF match condition',
      required: ['matchVariable', 'operator', 'matchValues'],
      properties: {
        matchVariable: {
          type: 'string',
          enum: [
            'RequestUri',
            'RequestMethod',
            'RequestHeader',
            'RequestBody',
            'SocketAddr',
            'QueryString',
          ],
          description: 'Part of the request to inspect',
        },
        operator: {
          type: 'string',
          enum: ['Contains', 'Equal', 'IPMatch', 'GreaterThan'],
          description: 'Comparison operator',
        },
        matchValues: {
          type: 'array',
          description: 'Values to match against',
          items: { type: 'string' },
        },
        transforms: {
          type: 'array',
          description: 'Text transforms (e.g., ["Lowercase", "UrlDecode"])',
          items: { type: 'string' },
        },
        selector: {
          type: 'string',
          description:
            'Header name (required when matchVariable is RequestHeader)',
        },
      },
      additionalProperties: false,
    },
    ...rateLimitConfig,
  };
}

/**
 * Generate the infrastructure.schema.json content
 * Uses actual constants for enums and constraints
 */
export function generateInfrastructureSchema(
  provider: SchemaProvider = 'gcp',
): string {
  const providerConfig = getProviderSchemaConfig(provider);

  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'tsdevstack Infrastructure Configuration',
    description:
      'Infrastructure configuration for tsdevstack framework projects',
    type: 'object',
    required: ['version'],
    properties: {
      $schema: {
        type: 'string',
        description: 'JSON Schema reference',
      },
      version: {
        type: 'string',
        description: "Schema version (e.g., '1.0.0')",
      },
    },
    additionalProperties: {
      $ref: '#/definitions/EnvironmentConfig',
    },
    definitions: {
      EnvironmentConfig: {
        type: 'object',
        description: 'Environment-specific configuration overrides',
        properties: {
          database: { $ref: '#/definitions/DatabaseOverride' },
          redis: { $ref: '#/definitions/RedisOverride' },
          kong: { $ref: '#/definitions/KongOverride' },
          loadBalancer: { $ref: '#/definitions/LoadBalancerOverride' },
          accessControl: { $ref: '#/definitions/AccessControlOverride' },
          security: { $ref: '#/definitions/SecurityOverride' },
          scheduledJobs: {
            type: 'array',
            description: 'Scheduled jobs configuration',
            items: { $ref: '#/definitions/ScheduledJobConfig' },
          },
          ...(providerConfig.appServiceSkus.length > 0
            ? {
                appService: {
                  $ref: '#/definitions/AppServiceOverride',
                },
                frontdoorPremium: {
                  type: 'boolean',
                  description:
                    'Enable Front Door Premium tier (Private Link origins, DRS 2.1 managed WAF rulesets, bot protection)',
                },
              }
            : {}),
        },
        // Allow service names directly under the environment
        additionalProperties: { $ref: '#/definitions/ServiceOverride' },
      },
      ServiceOverride: {
        type: 'object',
        description: providerConfig.serviceDescription,
        properties: {
          minInstances: {
            type: 'integer',
            minimum: providerConfig.minInstancesMinimum,
            maximum: VALIDATION_CONSTRAINTS.minInstances.max,
            description: providerConfig.serviceMinInstancesDescription,
          },
          maxInstances: {
            type: 'integer',
            minimum: VALIDATION_CONSTRAINTS.maxInstances.min,
            maximum: VALIDATION_CONSTRAINTS.maxInstances.max,
            description: 'Maximum number of instances',
          },
          cpu: {
            type: 'string',
            enum: [...providerConfig.cpuValues],
            description: providerConfig.cpuDescription,
          },
          memory: {
            type: 'string',
            enum: [...providerConfig.memoryValues],
            description: providerConfig.memoryDescription,
          },
          timeout: {
            type: 'string',
            pattern: '^[0-9]+s$',
            description: `Request timeout (${VALIDATION_CONSTRAINTS.timeout.minSeconds}s - ${VALIDATION_CONSTRAINTS.timeout.maxSeconds}s)`,
          },
          port: {
            type: 'integer',
            minimum: VALIDATION_CONSTRAINTS.port.min,
            maximum: VALIDATION_CONSTRAINTS.port.max,
            description: 'Container port',
          },
          concurrency: {
            type: 'integer',
            minimum: VALIDATION_CONSTRAINTS.concurrency.min,
            maximum: VALIDATION_CONSTRAINTS.concurrency.max,
            description: 'Max concurrent requests per instance',
          },
          domain: {
            type: 'string',
            description:
              "Full domain for frontend services (e.g., 'example.com')",
          },
          type: {
            type: 'string',
            enum: [...providerConfig.serviceTypes],
            description: providerConfig.serviceTypeDescription,
          },
        },
        additionalProperties: false,
      },
      DatabaseOverride: {
        type: 'object',
        description: providerConfig.databaseDescription,
        properties: {
          tier: {
            type: 'string',
            enum: [...providerConfig.databaseTiers],
            description: 'Machine tier',
          },
          diskSize: {
            type: 'integer',
            ...(providerConfig.databaseDiskSize.allowed
              ? { enum: [...providerConfig.databaseDiskSize.allowed] }
              : {
                  minimum: providerConfig.databaseDiskSize.min,
                  maximum: providerConfig.databaseDiskSize.max,
                }),
            description: 'Disk size in GB',
          },
          ha: {
            type: 'boolean',
            description: providerConfig.databaseHaDescription,
          },
          backup: {
            type: 'boolean',
            description: 'Enable automated backups',
          },
          deletionProtection: {
            type: 'boolean',
            description: 'Prevent accidental deletion',
          },
          ...(providerConfig.supportsDatabaseServerName
            ? {
                serverName: {
                  type: 'string',
                  minLength: AZURE_POSTGRES_SERVER_NAME_CONSTRAINTS.minLength,
                  maxLength: AZURE_POSTGRES_SERVER_NAME_CONSTRAINTS.maxLength,
                  pattern: AZURE_POSTGRES_SERVER_NAME_CONSTRAINTS.pattern,
                  description:
                    'Overrides the PostgreSQL Flexible Server name, a global DNS name in Azure. Default: {project}-{environment}-postgres. Changing it on an existing environment replaces the server and its data.',
                },
              }
            : {}),
          migrationJob: {
            $ref: '#/definitions/MigrationJobConfig',
          },
        },
        additionalProperties: false,
      },
      MigrationJobConfig: {
        type: 'object',
        description: providerConfig.migrationJobDescription,
        properties: {
          cpu: {
            type: 'string',
            enum: providerConfig.migrationJobCpuValues,
            description: providerConfig.migrationJobCpuDescription,
          },
          memory: {
            type: 'string',
            enum: providerConfig.migrationJobMemoryValues,
            description: providerConfig.migrationJobMemoryDescription,
          },
        },
        additionalProperties: false,
      },
      RedisOverride: {
        type: 'object',
        description: providerConfig.redisDescription,
        properties: {
          tier: {
            type: 'string',
            enum: [...providerConfig.redisTiers],
            description: providerConfig.redisTierDescription,
          },
          ...(providerConfig.supportsRedisMemoryGb
            ? {
                memoryGb: {
                  type: 'integer',
                  minimum: REDIS_CONSTRAINTS.memoryGb.min,
                  maximum: REDIS_CONSTRAINTS.memoryGb.max,
                  description: 'Memory size in GB',
                },
              }
            : {}),
        },
        additionalProperties: false,
      },
      KongOverride: {
        type: 'object',
        description: providerConfig.kongDescription,
        properties: {
          minInstances: {
            type: 'integer',
            minimum: providerConfig.minInstancesMinimum,
            maximum: VALIDATION_CONSTRAINTS.minInstances.max,
            description: providerConfig.kongMinInstancesDescription,
          },
          maxInstances: {
            type: 'integer',
            minimum: VALIDATION_CONSTRAINTS.maxInstances.min,
            maximum: VALIDATION_CONSTRAINTS.maxInstances.max,
            description: providerConfig.kongMaxInstancesDescription,
          },
          // On App Service the plan SKU sets CPU and memory
          ...(providerConfig.kongUsesAppService
            ? {}
            : {
                cpu: {
                  type: 'string',
                  enum: [...providerConfig.cpuValues],
                  description: providerConfig.cpuDescription,
                },
                memory: {
                  type: 'string',
                  enum: [...providerConfig.memoryValues],
                  description: providerConfig.memoryDescription,
                },
              }),
          maxUploadSize: {
            type: 'string',
            pattern: '^[0-9]+(m|k|g)$',
            description:
              "Max upload size for traditional file uploads through Kong (e.g., '10m', '50m'). Default: '10m'. Set '0' for unlimited.",
          },
        },
        additionalProperties: false,
      },
      LoadBalancerOverride: {
        type: 'object',
        description: 'External HTTP(S) Load Balancer configuration',
        properties: {
          apiDomain: {
            type: 'string',
            description: "Domain for API endpoint (e.g., 'api.example.com')",
          },
          redirectDomains: {
            type: 'array',
            description:
              "Domains to redirect to canonical domain (e.g., ['example.com', 'example.dev'])",
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
      AccessControlOverride: {
        type: 'object',
        description: 'Access control configuration',
        properties: {
          noIndex: {
            type: 'boolean',
            description:
              'Add X-Robots-Tag: noindex, nofollow header to all responses',
          },
        },
        additionalProperties: false,
      },
      SecurityOverride: {
        type: 'object',
        description: 'Security configuration (WAF, headers)',
        properties: {
          waf: { $ref: '#/definitions/WafOverride' },
        },
        additionalProperties: false,
      },
      ...buildWafSchemaDefinitions(provider),
      ScheduledJobConfig: {
        type: 'object',
        description: providerConfig.scheduledJobDescription,
        required: ['name', 'schedule', 'targetService', 'endpoint'],
        properties: {
          name: {
            type: 'string',
            description: 'Job name (e.g., "cleanup-tokens")',
          },
          schedule: {
            type: 'string',
            description: 'Cron schedule (e.g., "0 0 * * *" for daily)',
          },
          targetService: {
            type: 'string',
            description: 'Target service name (e.g., "auth-service")',
          },
          endpoint: {
            type: 'string',
            description: 'Endpoint path (e.g., "/jobs/cleanup-tokens")',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
            description: 'HTTP method (default: POST)',
          },
          httpTimeout: {
            type: 'integer',
            minimum: 1,
            maximum: 1800,
            description: 'HTTP timeout in seconds (default: 300)',
          },
          timezone: {
            type: 'string',
            description: 'Timezone (default: UTC)',
          },
        },
        additionalProperties: false,
      },
      ...(providerConfig.appServiceSkus.length > 0
        ? {
            AppServiceOverride: {
              type: 'object',
              description:
                'App Service Plan configuration (Azure only, for Kong and Next.js)',
              properties: {
                kongSku: {
                  type: 'string',
                  enum: [...providerConfig.appServiceSkus],
                  description:
                    'Kong App Service plan SKU (default: B1). B1-B3: a fixed kong.minInstances, no autoscale. S1-S3 and P1v3-P3v3: CPU autoscale between kong.minInstances and kong.maxInstances',
                },
                nextjsSku: {
                  type: 'string',
                  enum: [...providerConfig.appServiceSkus],
                  description:
                    'App Service plan SKU shared by the Next.js apps (default: B1). B1-B3: a fixed minInstances, no autoscale. S1-S3 and P1v3-P3v3: CPU autoscale between minInstances and maxInstances (the largest values among the Next.js apps)',
                },
              },
              additionalProperties: false,
            },
          }
        : {}),
    },
  };

  return JSON.stringify(schema, null, 2);
}
