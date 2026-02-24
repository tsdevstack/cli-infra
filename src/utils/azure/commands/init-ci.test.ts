import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockGeneratePrWorkflow = rs.fn();
const mockGenerateDeployWorkflow = rs.fn();
const mockGenerateDeployServicesWorkflow = rs.fn();
const mockGenerateDeployInfraWorkflow = rs.fn();
const mockGenerateDeployKongWorkflow = rs.fn();
const mockGenerateRemoveServiceWorkflow = rs.fn();
const mockPrintSetupInstructions = rs.fn();

rs.mock('../ci', () => ({
  generatePrWorkflow: () => mockGeneratePrWorkflow(),
  generateDeployWorkflow: (...args: unknown[]) =>
    mockGenerateDeployWorkflow(...args),
  generateDeployServicesWorkflow: (...args: unknown[]) =>
    mockGenerateDeployServicesWorkflow(...args),
  generateDeployInfraWorkflow: (...args: unknown[]) =>
    mockGenerateDeployInfraWorkflow(...args),
  generateDeployKongWorkflow: (...args: unknown[]) =>
    mockGenerateDeployKongWorkflow(...args),
  generateRemoveServiceWorkflow: (...args: unknown[]) =>
    mockGenerateRemoveServiceWorkflow(...args),
  printSetupInstructions: (...args: unknown[]) =>
    mockPrintSetupInstructions(...args),
}));

import { azureInitCi } from './init-ci';

describe('azureInitCi', () => {
  const mockAzureCredentials = {
    dev: {
      clientId: 'client-id-dev',
      tenantId: 'tenant-id-dev',
      subscriptionId: 'sub-id-dev',
      location: 'eastus',
    },
    prod: {
      clientId: 'client-id-prod',
      tenantId: 'tenant-id-prod',
      subscriptionId: 'sub-id-prod',
      location: 'eastus',
    },
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.findProjectRoot.mockReturnValue('/test/project');
    mocks.isFile.mockReturnValue(false);
    mocks.loadCredentialsFile.mockReturnValue(mockAzureCredentials);
    mocks.getAvailableEnvironments.mockReturnValue(['dev', 'prod']);
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs' },
        { name: 'frontend', type: 'nextjs' },
      ],
    });
    mocks.loadUserSecrets.mockReturnValue({
      secrets: { STRIPE_KEY: 'sk_test_xxx' },
    });
    mockGeneratePrWorkflow.mockReturnValue('# pr.yml');
    mockGenerateDeployWorkflow.mockReturnValue('# deploy.yml');
    mockGenerateDeployServicesWorkflow.mockReturnValue('# deploy-services.yml');
    mockGenerateDeployInfraWorkflow.mockReturnValue('# deploy-infra.yml');
    mockGenerateDeployKongWorkflow.mockReturnValue('# deploy-kong.yml');
    mockGenerateRemoveServiceWorkflow.mockReturnValue('# remove-service.yml');
  });

  describe('existing config detection', () => {
    it('should throw when ci.json already exists', async () => {
      mocks.isFile.mockReturnValue(true);

      await expect(azureInitCi()).rejects.toThrow(mocks.CliError);
    });

    it('should suggest generate-ci command when already initialized', async () => {
      mocks.isFile.mockReturnValue(true);

      try {
        await azureInitCi();
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as { hint?: string }).hint).toContain('generate-ci');
      }
    });
  });

  describe('credentials validation', () => {
    it('should throw when no credentials found', async () => {
      mocks.loadCredentialsFile.mockImplementation(() => {
        throw new Error('No credentials');
      });

      await expect(azureInitCi()).rejects.toThrow(mocks.CliError);
    });

    it('should throw when no environments configured', async () => {
      mocks.getAvailableEnvironments.mockReturnValue([]);

      await expect(azureInitCi()).rejects.toThrow(mocks.CliError);
    });

    it('should suggest cloud:init --azure when no environments', async () => {
      mocks.getAvailableEnvironments.mockReturnValue([]);

      try {
        await azureInitCi();
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as { hint?: string }).hint).toContain('cloud:init');
      }
    });
  });

  describe('config creation', () => {
    it('should create ci.json with provider and environments', async () => {
      await azureInitCi();

      expect(mocks.writeJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('ci.json'),
        expect.objectContaining({
          provider: 'github',
          environments: ['dev', 'prod'],
        }),
      );
    });
  });

  describe('workflow generation', () => {
    it('should create workflows directory', async () => {
      await azureInitCi();

      expect(mocks.ensureDirectory).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows'),
      );
    });

    it('should generate PR workflow', async () => {
      await azureInitCi();

      expect(mockGeneratePrWorkflow).toHaveBeenCalled();
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('pr.yml'),
        '# pr.yml',
      );
    });

    it('should generate deploy workflow', async () => {
      await azureInitCi();

      expect(mockGenerateDeployWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'github',
          environments: ['dev', 'prod'],
        }),
      );
    });

    it('should generate deploy-services workflow with services', async () => {
      await azureInitCi();

      expect(mockGenerateDeployServicesWorkflow).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ name: 'auth-service' }),
          expect.objectContaining({ name: 'frontend' }),
        ]),
      );
    });

    it('should generate all infrastructure workflows', async () => {
      await azureInitCi();

      expect(mockGenerateDeployInfraWorkflow).toHaveBeenCalled();
      expect(mockGenerateDeployKongWorkflow).toHaveBeenCalled();
    });

    it('should generate remove-service workflow', async () => {
      await azureInitCi();

      expect(mockGenerateRemoveServiceWorkflow).toHaveBeenCalled();
    });

    it('should not generate deploy-lb workflow', async () => {
      await azureInitCi();

      // Azure doesn't need deploy-lb (Front Door + App Service are Terraform-managed)
      const writeTextCalls = mocks.writeTextFile.mock.calls.map(
        (c: unknown[]) => c[0],
      );
      expect(writeTextCalls).not.toContain(
        expect.stringContaining('deploy-lb.yml'),
      );
    });
  });

  describe('setup instructions', () => {
    it('should print setup instructions', async () => {
      await azureInitCi();

      expect(mockPrintSetupInstructions).toHaveBeenCalledWith(
        ['STRIPE_KEY'],
        'my-app',
        ['dev', 'prod'],
        mocks.logger,
      );
    });

    it('should handle missing user secrets', async () => {
      mocks.loadUserSecrets.mockReturnValue(null);

      await azureInitCi();

      expect(mockPrintSetupInstructions).toHaveBeenCalledWith(
        [],
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('logging', () => {
    it('should log success message', async () => {
      await azureInitCi();

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('initialized successfully'),
      );
    });

    it('should log next steps', async () => {
      await azureInitCi();

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Next Steps'),
      );
    });
  });
});
