import { describe, it, expect } from '@rstest/core';
import { buildAzureSourceLegs } from './build-azure-source-legs';

const NAMES = {
  projectName: 'shop',
  targetEnv: 'az4',
  naming: { scheme: 'legacy' as const, subscriptionId: 'sub-1' },
};

describe('buildAzureSourceLegs', () => {
  describe('Standard use cases', () => {
    it("should read a service's output and platform events", () => {
      const legs = buildAzureSourceLegs(
        { name: 'auth-service', type: 'service' },
        NAMES,
        {},
      );
      expect(legs).toHaveLength(2);
      expect(legs[0]).toContain(
        'ContainerAppConsoleLogs | where ContainerAppName == "shop-auth-service"',
      );
      expect(legs[0]).toContain('Source = "auth-service", Kind = "app"');
      expect(legs[0]).toContain('Text = Log');
      expect(legs[1]).toContain(
        'ContainerAppSystemLogs | where ContainerAppName == "shop-auth-service"',
      );
      expect(legs[1]).toContain('Kind = "platform", Level = Type');
    });

    it("should read Kong's and Next.js's App Service logs", () => {
      const legs = buildAzureSourceLegs(
        { name: 'kong', type: 'kong' },
        NAMES,
        {},
      );
      expect(legs).toHaveLength(3);
      expect(legs[0]).toContain(
        'AppServiceConsoleLogs | where _ResourceId endswith "/sites/shop-az4-kong"',
      );
      expect(legs[1]).toContain('AppServicePlatformLogs');
      expect(legs[2]).toContain('AppServiceHTTPLogs');
      expect(legs[2]).toContain('iff(ScStatus >= 500, "error"');
    });

    it('should match a job and its executions', () => {
      const [output, system] = buildAzureSourceLegs(
        { name: 'cleanup-tokens', type: 'job' },
        NAMES,
        {},
      );
      expect(output).toContain(
        '(ContainerAppName == "shop-cleanup-tokens" or JobName == "shop-cleanup-tokens" or JobName matches regex "^shop-cleanup-tokens-[a-z0-9]+$")',
      );
      // A scheduled job's output is a platform line
      expect(output).toContain('Kind = "platform"');
      expect(system).toContain('ContainerAppSystemLogs');

      const [migration] = buildAzureSourceLegs(
        { name: 'migrate-auth-service', type: 'migration' },
        NAMES,
        {},
      );
      expect(migration).toContain('ContainerAppName == "migrate-auth-service"');
      expect(migration).toContain('Kind = "app"');
    });

    it('should read the database setup job, whose output is app lines', () => {
      const [output, system] = buildAzureSourceLegs(
        { name: 'db-init', type: 'db-init' },
        NAMES,
        {},
      );
      expect(output).toContain(
        '(ContainerAppName == "db-init" or JobName == "db-init" or JobName matches regex "^db-init-[a-z0-9]+$")',
      );
      expect(output).toContain('Kind = "app"');
      expect(system).toContain('ContainerAppSystemLogs');
    });

    it("should read Front Door's request and WAF logs", () => {
      const [edge] = buildAzureSourceLegs(
        { name: 'edge', type: 'edge' },
        NAMES,
        {},
      );
      expect(edge).toContain(
        'AzureDiagnostics | where Category in ("FrontDoorAccessLog", "FrontDoorWebApplicationFirewallLog")',
      );
      expect(edge).toContain('Kind = "edge"');
    });
  });

  describe('Edge cases', () => {
    it('should filter app lines by their JSON level', () => {
      const [app, platform] = buildAzureSourceLegs(
        { name: 'auth-service', type: 'service' },
        NAMES,
        { level: 'error' },
      );
      expect(app).toContain(
        '| where tostring(parse_json(Text).level) in ("error", "fatal")',
      );
      expect(platform).not.toContain('parse_json');
    });

    it("should read only App Service's request log when the rest comes live from Kudu (--follow)", () => {
      for (const source of [
        { name: 'kong', type: 'kong' as const },
        { name: 'frontend', type: 'frontend' as const },
      ]) {
        const legs = buildAzureSourceLegs(source, NAMES, {
          appServiceLive: true,
        });
        expect(legs).toHaveLength(1);
        expect(legs[0]).toContain('AppServiceHTTPLogs');
      }
      expect(
        buildAzureSourceLegs({ name: 'kong', type: 'kong' }, NAMES, {
          appServiceLive: true,
          kind: 'app',
        }),
      ).toEqual([]);
      // Other sources don't change
      expect(
        buildAzureSourceLegs({ name: 'auth-service', type: 'service' }, NAMES, {
          appServiceLive: true,
        }),
      ).toHaveLength(2);
    });

    it('should keep only the legs of the requested kind', () => {
      expect(
        buildAzureSourceLegs({ name: 'kong', type: 'kong' }, NAMES, {
          kind: 'platform',
        }),
      ).toHaveLength(2);
      expect(
        buildAzureSourceLegs({ name: 'kong', type: 'kong' }, NAMES, {
          kind: 'edge',
        }),
      ).toEqual([]);
    });
  });

  describe('Unique naming scheme', () => {
    it("should read the App Service by its name with the subscription's suffix", () => {
      const legs = buildAzureSourceLegs(
        { name: 'kong', type: 'kong' },
        {
          ...NAMES,
          naming: {
            scheme: 'unique',
            subscriptionId: '00000000-0000-0000-0000-000000000000',
          },
        },
        {},
      );

      expect(legs[0]).toContain(
        '_ResourceId endswith "/sites/shop-az4-kong-12b937"',
      );
      expect(legs[0]).toContain('Source = "kong"');
    });
  });

  describe('Storage buckets', () => {
    const bucket = {
      name: 'bucket-uploads',
      type: 'bucket' as const,
      bucket: 'uploads',
    };

    // az5 round: the query used the config name (uploads), not the container
    // ({project}-{bucket}-{env}), and found nothing
    it("should read the container's blob logs as platform lines", () => {
      const legs = buildAzureSourceLegs(bucket, NAMES, {});

      expect(legs).toHaveLength(1);
      expect(legs[0]).toContain(
        'StorageBlobLogs | where AccountName == "shopaz4storage" and (ObjectKey == "/shopaz4storage/shop-uploads-az4" or ObjectKey startswith "/shopaz4storage/shop-uploads-az4/")',
      );
      expect(legs[0]).toContain('Source = "bucket-uploads", Kind = "platform"');
      expect(legs[0]).toContain(
        'Level = iff(toint(StatusCode) >= 500, "error", iff(toint(StatusCode) >= 400, "warn", "info"))',
      );
    });

    it('should build the line every provider shows: operation, object, error, who, address', () => {
      const [leg] = buildAzureSourceLegs(bucket, NAMES, {});

      expect(leg).toContain(
        'Text = strcat(OperationName, " ", iff(ObjectKey startswith "/shopaz4storage/shop-uploads-az4/", substring(ObjectKey, 33), "(bucket)"), iff(toint(StatusCode) >= 400, strcat(" ", StatusCode, " ", StatusText), ""), iff(isempty(coalesce(RequesterUpn, AuthenticationType)), "", strcat(" by ", coalesce(RequesterUpn, AuthenticationType))), iff(isempty(CallerIpAddress), "", strcat(" from ", iff(CallerIpAddress matches regex @"^.+:[0-9]+$", extract(@"^(.+):[0-9]+$", 1, CallerIpAddress), CallerIpAddress))))',
      );
    });

    it('should read the account by its unique name', () => {
      const [leg] = buildAzureSourceLegs(
        bucket,
        {
          ...NAMES,
          naming: {
            scheme: 'unique',
            subscriptionId: '00000000-0000-0000-0000-000000000000',
          },
        },
        {},
      );
      expect(leg).toContain('AccountName == "shopaz4st12b937"');
    });

    it('should read nothing for another kind', () => {
      expect(buildAzureSourceLegs(bucket, NAMES, { kind: 'app' })).toEqual([]);
    });
  });
  describe('Cron jobs', () => {
    it("should read a cron job's Container App Job as app output, with the level filter", () => {
      const [output, system] = buildAzureSourceLegs(
        { name: 'usage-report', type: 'cron', service: 'auth-service' },
        NAMES,
        { level: 'error' },
      );
      expect(output).toContain(
        '(ContainerAppName == "shop-cron-usage-report" or JobName == "shop-cron-usage-report" or JobName matches regex "^shop-cron-usage-report-[a-z0-9]+$")',
      );
      expect(output).toContain('Kind = "app"');
      expect(output).toContain(
        'tostring(parse_json(Text).level) in ("error", "fatal")',
      );
      expect(system).toContain('ContainerAppSystemLogs');
      expect(system).toContain('Kind = "platform"');
    });
  });
});
