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

import { awsInitCi } from './init-ci';

describe('awsInitCi', () => {
  const environments = ['dev', 'prod'];
  const projectName = 'my-app';

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.findProjectRoot.mockReturnValue('/test/project');
    mocks.isFile.mockReturnValue(false);
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

      await expect(awsInitCi(environments, projectName)).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should suggest generate-ci command when already initialized', async () => {
      mocks.isFile.mockReturnValue(true);

      try {
        await awsInitCi(environments, projectName);
        expect.fail('Should have thrown');
      } catch (e) {
        expect((e as { hint?: string }).hint).toContain('generate-ci');
      }
    });
  });

  describe('config creation', () => {
    it('should create ci.json with provider and environments', async () => {
      await awsInitCi(environments, projectName);

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
      await awsInitCi(environments, projectName);

      expect(mocks.ensureDirectory).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows'),
      );
    });

    it('should generate PR workflow', async () => {
      await awsInitCi(environments, projectName);

      expect(mockGeneratePrWorkflow).toHaveBeenCalled();
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('pr.yml'),
        '# pr.yml',
      );
    });

    it('should generate deploy workflow', async () => {
      await awsInitCi(environments, projectName);

      expect(mockGenerateDeployWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'github',
          environments: ['dev', 'prod'],
        }),
        { npmAuth: false },
      );
    });

    it('should generate deploy-services workflow with services', async () => {
      await awsInitCi(environments, projectName);

      expect(mockGenerateDeployServicesWorkflow).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ name: 'auth-service' }),
          expect.objectContaining({ name: 'frontend' }),
        ]),
        { npmAuth: false },
      );
    });

    it('should generate all infrastructure workflows', async () => {
      await awsInitCi(environments, projectName);

      expect(mockGenerateDeployInfraWorkflow).toHaveBeenCalled();
      expect(mockGenerateDeployKongWorkflow).toHaveBeenCalled();
    });

    it('should generate remove-service workflow', async () => {
      await awsInitCi(environments, projectName);

      expect(mockGenerateRemoveServiceWorkflow).toHaveBeenCalled();
    });

    it('should not generate deploy-lb workflow', async () => {
      await awsInitCi(environments, projectName);

      // AWS doesn't need deploy-lb (ALB is in Terraform)
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
      await awsInitCi(environments, projectName);

      expect(mockPrintSetupInstructions).toHaveBeenCalledWith(
        ['STRIPE_KEY'],
        'my-app',
        ['dev', 'prod'],
        mocks.logger,
      );
    });

    it('should handle missing user secrets', async () => {
      mocks.loadUserSecrets.mockReturnValue(null);

      await awsInitCi(environments, projectName);

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
      await awsInitCi(environments, projectName);

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('initialized successfully'),
      );
    });

    it('should log next steps', async () => {
      await awsInitCi(environments, projectName);

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Next Steps'),
      );
    });
  });
});
