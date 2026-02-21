/**
 * Generate Infrastructure Schema
 *
 * Dynamically generates JSON schema for infrastructure.json
 * based on actual constants and constraints.
 */

import {
  VALID_CPU_VALUES,
  VALID_MEMORY_VALUES,
  VALIDATION_CONSTRAINTS,
  DATABASE_CONSTRAINTS,
  REDIS_CONSTRAINTS,
} from '../../constants';
import {
  getProviderSchemaConfig,
  type SchemaProvider,
} from './get-provider-schema-config';

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
            minimum: VALIDATION_CONSTRAINTS.minInstances.min,
            maximum: VALIDATION_CONSTRAINTS.minInstances.max,
            description: 'Minimum number of instances (0 = scale to zero)',
          },
          maxInstances: {
            type: 'integer',
            minimum: VALIDATION_CONSTRAINTS.maxInstances.min,
            maximum: VALIDATION_CONSTRAINTS.maxInstances.max,
            description: 'Maximum number of instances',
          },
          cpu: {
            type: 'string',
            enum: [...VALID_CPU_VALUES],
            description: 'CPU allocation per instance',
          },
          memory: {
            type: 'string',
            enum: [...VALID_MEMORY_VALUES],
            description: "Memory allocation (e.g., '512Mi', '1Gi', '2Gi')",
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
            minimum: DATABASE_CONSTRAINTS.diskSize.min,
            maximum: DATABASE_CONSTRAINTS.diskSize.max,
            description: 'Disk size in GB',
          },
          ha: {
            type: 'boolean',
            description: 'Enable high availability (regional)',
          },
          backup: {
            type: 'boolean',
            description: 'Enable automated backups',
          },
          deletionProtection: {
            type: 'boolean',
            description: 'Prevent accidental deletion',
          },
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
          memoryGb: {
            type: 'integer',
            minimum: REDIS_CONSTRAINTS.memoryGb.min,
            maximum: REDIS_CONSTRAINTS.memoryGb.max,
            description: 'Memory size in GB',
          },
        },
        additionalProperties: false,
      },
      KongOverride: {
        type: 'object',
        description: providerConfig.kongDescription,
        properties: providerConfig.kongUsesAppService
          ? {}
          : {
              minInstances: {
                type: 'integer',
                minimum: VALIDATION_CONSTRAINTS.minInstances.min,
                maximum: VALIDATION_CONSTRAINTS.minInstances.max,
                description: 'Minimum number of instances',
              },
              maxInstances: {
                type: 'integer',
                minimum: VALIDATION_CONSTRAINTS.maxInstances.min,
                maximum: VALIDATION_CONSTRAINTS.maxInstances.max,
                description: 'Maximum number of instances',
              },
              cpu: {
                type: 'string',
                enum: [...VALID_CPU_VALUES],
                description: 'CPU allocation per instance',
              },
              memory: {
                type: 'string',
                enum: [...VALID_MEMORY_VALUES],
                description: "Memory allocation (e.g., '1Gi', '2Gi')",
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
          protected: {
            type: 'boolean',
            description: 'Restrict access (e.g., IP allowlist)',
          },
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
      WafOverride: {
        type: 'object',
        description: 'Cloud Armor WAF configuration',
        properties: {
          customRules: {
            type: 'array',
            description: 'Custom WAF rules to add to Cloud Armor policy',
            items: { $ref: '#/definitions/WafCustomRule' },
          },
        },
        additionalProperties: false,
      },
      WafCustomRule: {
        type: 'object',
        description: 'Custom Cloud Armor WAF rule',
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
      WafRateLimitConfig: {
        type: 'object',
        description:
          "Rate limit configuration (required if action is 'throttle')",
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
                  description: 'Kong App Service Plan SKU (default: B1)',
                },
                nextjsSku: {
                  type: 'string',
                  enum: [...providerConfig.appServiceSkus],
                  description: 'Next.js App Service Plan SKU (default: B1)',
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
