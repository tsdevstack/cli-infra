import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('@tsdevstack/infra-core', () => ({
  azure: {
    generateMainTf: rs.fn(() => '# main.tf'),
    generateVariablesTf: rs.fn(() => '# variables.tf'),
    generateTfvars: rs.fn(() => '# terraform.tfvars'),
    generateOutputsTf: rs.fn(() => '# outputs.tf'),
    generateNetworkTf: rs.fn(() => '# network.tf'),
    generateAcrTf: rs.fn(() => '# acr.tf'),
    generateContainerAppsEnvTf: rs.fn(() => '# container-apps-env.tf'),
    generateDatabaseTf: rs.fn(() => '# database.tf'),
    generateRedisTf: rs.fn(() => '# redis.tf'),
    generateFrontdoorTf: rs.fn(() => '# frontdoor.tf'),
    generateSpaStorageTf: rs.fn(() => '# spa-storage.tf'),
    generateDnsTf: rs.fn(() => '# dns.tf'),
    generateWafTf: rs.fn(() => '# waf.tf'),
    generateScheduledJobsTf: rs.fn(() => ''),
    generateAppServiceTf: rs.fn(() => '# app-service.tf'),
    generateDiagnosticsTf: rs.fn(() => '# diagnostics.tf'),
  },
}));

rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => null),
}));

rs.mock('../../infrastructure/merge-with-defaults', () => ({
  getScheduledJobs: rs.fn(() => []),
  getDatabaseConfig: rs.fn(() => ({
    tier: 'B_Standard_B1ms',
    diskSize: 32,
    deletionProtection: true,
    ha: false,
    backup: false,
  })),
  getRedisConfig: rs.fn(() => ({
    tier: 'Balanced_B0',
    memoryGb: 1,
  })),
  getServiceConfig: rs.fn(() => ({
    minInstances: 0,
    maxInstances: 5,
    cpu: '0.25',
    memory: '0.5Gi',
    timeout: '300s',
    port: 3000,
    concurrency: 80,
  })),
  getAppServiceConfig: rs.fn(() => ({
    kongSku: 'B1',
    nextjsSku: 'B1',
  })),
}));

import { generateTerraformFiles } from './generate-terraform-files';
import { azure } from '@tsdevstack/infra-core';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import {
  getDatabaseConfig,
  getRedisConfig,
  getServiceConfig,
  getAppServiceConfig,
} from '../../infrastructure/merge-with-defaults';

describe('generateTerraformFiles', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      subscriptionId: 'sub-123',
      tenantId: 'tenant-456',
      clientId: 'client-789',
      clientSecret: 'secret-abc',
      location: 'eastus',
    },
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();

    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'bff-service', type: 'nestjs', hasDatabase: false },
        { name: 'frontend', type: 'nextjs' },
        { name: 'react-app', type: 'spa' },
      ],
    });

    (mocks as Record<string, unknown>).cleanupFolder = rs.fn();
  });

  it('should return correct output directory', () => {
    const result = generateTerraformFiles(mockCtx, 'infra:generate');

    expect(result.outputDir).toBe('/test/project/infrastructure/terraform/dev');
  });

  it('should ensure output directory exists', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    expect(mocks.ensureDirectory).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev',
    );
  });

  it('should clean up old generated files', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    expect(
      (mocks as unknown as Record<string, ReturnType<typeof rs.fn>>)
        .cleanupFolder,
    ).toHaveBeenCalledWith('/test/project/infrastructure/terraform/dev', [
      '.terraform',
      '.terraform.lock.hcl',
    ]);
  });

  it('should call all generators', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    expect(azure.generateMainTf).toHaveBeenCalled();
    expect(azure.generateVariablesTf).toHaveBeenCalled();
    expect(azure.generateTfvars).toHaveBeenCalled();
    expect(azure.generateOutputsTf).toHaveBeenCalled();
    expect(azure.generateNetworkTf).toHaveBeenCalled();
    expect(azure.generateAcrTf).toHaveBeenCalled();
    expect(azure.generateContainerAppsEnvTf).toHaveBeenCalled();
    expect(azure.generateDatabaseTf).toHaveBeenCalled();
    expect(azure.generateRedisTf).toHaveBeenCalled();
    expect(azure.generateFrontdoorTf).toHaveBeenCalled();
    expect(azure.generateSpaStorageTf).toHaveBeenCalled();
    expect(azure.generateDnsTf).toHaveBeenCalled();
    expect(azure.generateWafTf).toHaveBeenCalled();
    expect(azure.generateAppServiceTf).toHaveBeenCalled();
    expect(azure.generateDiagnosticsTf).toHaveBeenCalled();
  });

  it('should write all generated files', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    expect(mocks.writeTextFile).toHaveBeenCalledTimes(15);
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/main.tf',
      '# main.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/variables.tf',
      '# variables.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/terraform.tfvars',
      '# terraform.tfvars',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/outputs.tf',
      '# outputs.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/network.tf',
      '# network.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/acr.tf',
      '# acr.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/container-apps-env.tf',
      '# container-apps-env.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/database.tf',
      '# database.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/redis.tf',
      '# redis.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/frontdoor.tf',
      '# frontdoor.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/spa-storage.tf',
      '# spa-storage.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/dns.tf',
      '# dns.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/waf.tf',
      '# waf.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/app-service.tf',
      '# app-service.tf',
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      '/test/project/infrastructure/terraform/dev/diagnostics.tf',
      '# diagnostics.tf',
    );
  });

  it('should log file names when verbose', () => {
    generateTerraformFiles(mockCtx, 'infra:generate', { verbose: true });

    expect(mocks.logger.generating).toHaveBeenCalledWith('  main.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  variables.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  terraform.tfvars');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  outputs.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  network.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  acr.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith(
      '  container-apps-env.tf',
    );
    expect(mocks.logger.generating).toHaveBeenCalledWith('  database.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  redis.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  frontdoor.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  spa-storage.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  dns.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  waf.tf');
    expect(mocks.logger.generating).toHaveBeenCalledWith('  app-service.tf');
  });

  it('should not log file names when not verbose', () => {
    generateTerraformFiles(mockCtx, 'infra:generate');

    expect(mocks.logger.generating).not.toHaveBeenCalled();
  });

  describe('domain wiring', () => {
    it('should fetch DOMAIN secret via executeCommand', () => {
      mocks.executeCommand.mockReturnValue('example.com\n');
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(mocks.executeCommand).toHaveBeenCalledWith(
        'npx tsdevstack cloud-secrets:get DOMAIN --env dev',
        { stdio: 'pipe', logCommand: false, exitOnError: false },
      );
    });

    it('should pass baseDomain to generators when DOMAIN secret exists', () => {
      mocks.executeCommand.mockReturnValue('example.com\n');
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateDnsTf).toHaveBeenCalledWith(
        expect.objectContaining({ baseDomain: 'example.com' }),
      );
    });

    it('should pass empty baseDomain when DOMAIN secret not found', () => {
      mocks.executeCommand.mockImplementation(() => {
        throw new Error('secret not found');
      });
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateDnsTf).toHaveBeenCalledWith(
        expect.objectContaining({ baseDomain: '' }),
      );
    });

    it('should warn when DOMAIN secret not found', () => {
      mocks.executeCommand.mockImplementation(() => {
        throw new Error('secret not found');
      });
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('DOMAIN secret not found'),
      );
    });

    it('should set SPA domain to {name}.{baseDomain} when domain exists', () => {
      mocks.executeCommand.mockReturnValue('example.com\n');
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateFrontdoorTf).toHaveBeenCalledWith(
        expect.objectContaining({
          spas: expect.objectContaining({
            'react-app': { domain: 'react-app.example.com' },
          }),
        }),
      );
    });

    it('should set Next.js domain to {name}.{baseDomain} when domain exists', () => {
      mocks.executeCommand.mockReturnValue('example.com\n');
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateFrontdoorTf).toHaveBeenCalledWith(
        expect.objectContaining({
          frontends: expect.objectContaining({
            frontend: expect.objectContaining({
              domain: 'frontend.example.com',
            }),
          }),
        }),
      );
    });

    it('should leave domains empty when baseDomain is empty', () => {
      mocks.executeCommand.mockImplementation(() => {
        throw new Error('secret not found');
      });
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateFrontdoorTf).toHaveBeenCalledWith(
        expect.objectContaining({
          spas: expect.objectContaining({
            'react-app': { domain: '' },
          }),
          frontends: expect.objectContaining({
            frontend: expect.objectContaining({ domain: '' }),
          }),
        }),
      );
    });
  });

  describe('infrastructure config flow', () => {
    it('should call getDatabaseConfig with azure provider', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(getDatabaseConfig).toHaveBeenCalledWith(null, 'dev', 'azure');
    });

    it('should call getRedisConfig with azure provider', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(getRedisConfig).toHaveBeenCalledWith(null, 'dev', 'azure');
    });

    it('should call getServiceConfig for each nestjs and nextjs service', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(getServiceConfig).toHaveBeenCalledWith(
        null,
        'auth-service',
        'dev',
        'azure',
      );
      expect(getServiceConfig).toHaveBeenCalledWith(
        null,
        'bff-service',
        'dev',
        'azure',
      );
      expect(getServiceConfig).toHaveBeenCalledWith(
        null,
        'frontend',
        'dev',
        'azure',
      );
    });

    it('should call getAppServiceConfig', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(getAppServiceConfig).toHaveBeenCalledWith(null, 'dev');
    });

    it('should pass merged database config to generators', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateDatabaseTf).toHaveBeenCalledWith(
        expect.objectContaining({
          database: {
            tier: 'B_Standard_B1ms',
            storageSizeGb: 32,
            deletionProtection: false,
            backup: false,
          },
        }),
      );
    });

    it('should pass merged redis config to generators', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateRedisTf).toHaveBeenCalledWith(
        expect.objectContaining({
          redis: { tier: 'Balanced_B0' },
        }),
      );
    });

    it('should pass merged service config to generators', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateMainTf).toHaveBeenCalledWith(
        expect.objectContaining({
          services: expect.objectContaining({
            'auth-service': {
              cpu: 0.25,
              memory: '0.5Gi',
              minInstances: 0,
              maxInstances: 5,
            },
          }),
        }),
      );
    });

    it('should use infrastructure overrides when config exists', () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1',
        dev: { database: { tier: 'GP_Standard_D2s_v3', diskSize: 64 } },
      });
      rs.mocked(getDatabaseConfig).mockReturnValue({
        tier: 'GP_Standard_D2s_v3',
        diskSize: 64,
        deletionProtection: true,
        ha: false,
        backup: false,
      });

      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateDatabaseTf).toHaveBeenCalledWith(
        expect.objectContaining({
          database: expect.objectContaining({
            tier: 'GP_Standard_D2s_v3',
            storageSizeGb: 64,
          }),
        }),
      );
    });

    it('should pass App Service SKUs to generators', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateAppServiceTf).toHaveBeenCalledWith(
        expect.objectContaining({
          kongAppServiceSku: 'B1',
          nextjsAppServiceSku: 'B1',
        }),
      );
    });

    it('should read noIndex from raw infrastructure config', () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1',
        dev: { accessControl: { noIndex: true } },
      } as ReturnType<typeof loadInfrastructureConfig>);

      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateFrontdoorTf).toHaveBeenCalledWith(
        expect.objectContaining({
          noIndex: true,
        }),
      );
    });

    it('should use domain from infrastructure.json when configured', () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1',
        dev: {
          frontend: { domain: 'example.com' },
          'react-app': { domain: 'app.example.com' },
        },
      } as ReturnType<typeof loadInfrastructureConfig>);
      mocks.executeCommand.mockReturnValue('example.com\n');

      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateFrontdoorTf).toHaveBeenCalledWith(
        expect.objectContaining({
          frontends: expect.objectContaining({
            frontend: expect.objectContaining({ domain: 'example.com' }),
          }),
          spas: expect.objectContaining({
            'react-app': { domain: 'app.example.com' },
          }),
        }),
      );
    });

    it('should default noIndex to false when not configured', () => {
      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateFrontdoorTf).toHaveBeenCalledWith(
        expect.objectContaining({
          noIndex: false,
        }),
      );
    });

    it('should read deletionProtection from raw infrastructure config', () => {
      rs.mocked(loadInfrastructureConfig).mockReturnValue({
        version: '1',
        dev: { database: { deletionProtection: true } },
      } as ReturnType<typeof loadInfrastructureConfig>);

      generateTerraformFiles(mockCtx, 'infra:generate');

      expect(azure.generateDatabaseTf).toHaveBeenCalledWith(
        expect.objectContaining({
          database: expect.objectContaining({
            deletionProtection: true,
          }),
        }),
      );
    });
  });
});
