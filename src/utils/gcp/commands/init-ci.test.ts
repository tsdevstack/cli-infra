import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

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
const mockGenerateDeployLbWorkflow = rs.fn();
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
  generateDeployLbWorkflow: (...args: unknown[]) =>
    mockGenerateDeployLbWorkflow(...args),
  generateRemoveServiceWorkflow: (...args: unknown[]) =>
    mockGenerateRemoveServiceWorkflow(...args),
  printSetupInstructions: (...args: unknown[]) =>
    mockPrintSetupInstructions(...args),
}));

import { gcpInitCi } from './init-ci';

describe('gcpInitCi', () => {
  const mockGCPCredentials = {
    prod: {
      project_id: 'gcp-project-123',
      region: 'us-central1',
    },
    staging: {
      project_id: 'gcp-project-staging',
      region: 'us-central1',
    },
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.findProjectRoot.mockReturnValue('/test/project');
    mocks.isFile.mockReturnValue(false);
    mocks.loadCredentialsFile.mockReturnValue(mockGCPCredentials);
    mocks.getAvailableEnvironments.mockReturnValue(['prod', 'staging']);
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
    mockGenerateDeployLbWorkflow.mockReturnValue('# deploy-lb.yml');
    mockGenerateRemoveServiceWorkflow.mockReturnValue('# remove-service.yml');
  });

  describe('existing config detection', () => {
    it('should throw when ci.json already exists', async () => {
      mocks.isFile.mockReturnValue(true);

      await expect(gcpInitCi()).rejects.toThrow(mocks.CliError);
    });

    it('should suggest generate-ci command when already initialized', async () => {
      mocks.isFile.mockReturnValue(true);

      try {
        await gcpInitCi();
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

      await expect(gcpInitCi()).rejects.toThrow(mocks.CliError);
    });

    it('should throw when no environments configured', async () => {
      mocks.getAvailableEnvironments.mockReturnValue([]);

      await expect(gcpInitCi()).rejects.toThrow(mocks.CliError);
    });

    it('should suggest cloud:init when no environments', async () => {
      mocks.getAvailableEnvironments.mockReturnValue([]);

      try {
        await gcpInitCi();
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as { hint?: string }).hint).toContain('cloud:init');
      }
    });
  });

  describe('config creation', () => {
    it('should create ci.json with provider and environments', async () => {
      await gcpInitCi();

      expect(mocks.writeJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('ci.json'),
        expect.objectContaining({
          provider: 'github',
          environments: ['prod', 'staging'],
        }),
      );
    });
  });

  describe('workflow generation', () => {
    it('should create workflows directory', async () => {
      await gcpInitCi();

      expect(mocks.ensureDirectory).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows'),
      );
    });

    it('should generate PR workflow', async () => {
      await gcpInitCi();

      expect(mockGeneratePrWorkflow).toHaveBeenCalled();
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('pr.yml'),
        '# pr.yml',
      );
    });

    it('should generate deploy workflow', async () => {
      await gcpInitCi();

      expect(mockGenerateDeployWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'github',
          environments: ['prod', 'staging'],
        }),
      );
    });

    it('should generate deploy-services workflow with services', async () => {
      await gcpInitCi();

      expect(mockGenerateDeployServicesWorkflow).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ name: 'auth-service' }),
          expect.objectContaining({ name: 'frontend' }),
        ]),
      );
    });

    it('should generate all infrastructure workflows', async () => {
      await gcpInitCi();

      expect(mockGenerateDeployInfraWorkflow).toHaveBeenCalled();
      expect(mockGenerateDeployKongWorkflow).toHaveBeenCalled();
      expect(mockGenerateDeployLbWorkflow).toHaveBeenCalled();
    });

    it('should generate remove-service workflow', async () => {
      await gcpInitCi();

      expect(mockGenerateRemoveServiceWorkflow).toHaveBeenCalled();
    });
  });

  describe('setup instructions', () => {
    it('should print setup instructions', async () => {
      await gcpInitCi();

      expect(mockPrintSetupInstructions).toHaveBeenCalledWith(
        ['STRIPE_KEY'],
        'my-app',
        'gcp-project-123',
        ['prod', 'staging'],
        mocks.logger,
      );
    });

    it('should handle missing user secrets', async () => {
      mocks.loadUserSecrets.mockReturnValue(null);

      await gcpInitCi();

      expect(mockPrintSetupInstructions).toHaveBeenCalledWith(
        [],
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });

  describe('logging', () => {
    it('should log success message', async () => {
      await gcpInitCi();

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('initialized successfully'),
      );
    });

    it('should log next steps', async () => {
      await gcpInitCi();

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Next Steps'),
      );
    });
  });
});
