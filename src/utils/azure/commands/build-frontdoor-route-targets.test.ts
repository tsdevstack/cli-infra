import { describe, it, expect } from '@rstest/core';
import { buildFrontdoorRouteTargets } from './build-frontdoor-route-targets';
import type { AzureInfraConfig } from '@tsdevstack/infra-core';

function makeConfig(
  overrides: Partial<AzureInfraConfig> = {},
): AzureInfraConfig {
  return {
    provider: 'azure',
    projectName: 'test-project',
    environment: 'dev',
    subscriptionId: 'sub-123',
    location: 'eastus2',
    storageAccountName: 'testprojectdevtfstate',
    database: {
      tier: 'B_Standard_B1ms',
      storageSizeGb: 32,
      deletionProtection: false,
      backup: false,
    },
    redis: { tier: 'Basic' },
    servicesWithDatabase: [],
    baseDomain: 'example.com',
    services: {},
    workers: {},
    allDeployables: {},
    spas: {},
    frontends: {},
    scheduledJobs: {},
    noIndex: false,
    frontdoorPremium: false,
    kongAppServiceSku: 'B1',
    nextjsAppServiceSku: 'B1',
    ...overrides,
  };
}

describe('buildFrontdoorRouteTargets', () => {
  it('should always include api route and security policy', () => {
    const targets = buildFrontdoorRouteTargets(makeConfig());

    expect(targets).toContain('azurerm_cdn_frontdoor_route.api');
    expect(targets).toContain('azurerm_cdn_frontdoor_security_policy.main');
    expect(targets).toHaveLength(2);
  });

  it('should include nextjs route when nextjs services exist', () => {
    const targets = buildFrontdoorRouteTargets(
      makeConfig({
        frontends: {
          frontend: {
            domain: 'app.example.com',
            cpu: 0.25,
            memory: '0.5Gi',
            minInstances: 1,
            maxInstances: 3,
          },
        },
      }),
    );

    expect(targets).toContain('azurerm_cdn_frontdoor_route.nextjs_frontend');
    expect(targets).toHaveLength(3);
  });

  it('should include route per nextjs service when multiple exist', () => {
    const targets = buildFrontdoorRouteTargets(
      makeConfig({
        frontends: {
          frontend: {
            domain: 'app.example.com',
            cpu: 0.25,
            memory: '0.5Gi',
            minInstances: 1,
            maxInstances: 3,
          },
          dashboard: {
            domain: 'dashboard.example.com',
            cpu: 0.25,
            memory: '0.5Gi',
            minInstances: 0,
            maxInstances: 3,
          },
        },
      }),
    );

    expect(targets).toContain('azurerm_cdn_frontdoor_route.nextjs_frontend');
    expect(targets).toContain('azurerm_cdn_frontdoor_route.nextjs_dashboard');
    expect(targets).toHaveLength(4);
  });

  it('should include spa routes with terraform-safe names', () => {
    const targets = buildFrontdoorRouteTargets(
      makeConfig({
        spas: {
          'react-app': { domain: 'react-app.example.com' },
          'admin-panel': { domain: 'admin-panel.example.com' },
        },
      }),
    );

    expect(targets).toContain('azurerm_cdn_frontdoor_route.spa_react_app');
    expect(targets).toContain('azurerm_cdn_frontdoor_route.spa_admin_panel');
    expect(targets).toHaveLength(4);
  });

  it('should include all targets when all service types exist', () => {
    const targets = buildFrontdoorRouteTargets(
      makeConfig({
        frontends: {
          frontend: {
            domain: 'app.example.com',
            cpu: 0.25,
            memory: '0.5Gi',
            minInstances: 1,
            maxInstances: 3,
          },
        },
        spas: {
          'react-app': { domain: 'react-app.example.com' },
        },
      }),
    );

    expect(targets).toEqual([
      'azurerm_cdn_frontdoor_route.api',
      'azurerm_cdn_frontdoor_security_policy.main',
      'azurerm_cdn_frontdoor_route.nextjs_frontend',
      'azurerm_cdn_frontdoor_route.spa_react_app',
    ]);
  });
});
