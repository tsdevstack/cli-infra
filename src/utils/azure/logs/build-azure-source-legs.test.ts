import { describe, it, expect } from '@rstest/core';
import { buildAzureSourceLegs } from './build-azure-source-legs';

const NAMES = { projectName: 'shop', targetEnv: 'az4' };

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
});
