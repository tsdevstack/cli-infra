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
const mockGenerateDeployScheduledJobsWorkflow = rs.fn();
const mockGenerateRemoveServiceWorkflow = rs.fn();
const mockGenerateRemoveDetachedWorkerWorkflow = rs.fn();

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
  generateDeployScheduledJobsWorkflow: (...args: unknown[]) =>
    mockGenerateDeployScheduledJobsWorkflow(...args),
  generateRemoveServiceWorkflow: (...args: unknown[]) =>
    mockGenerateRemoveServiceWorkflow(...args),
  generateRemoveDetachedWorkerWorkflow: (...args: unknown[]) =>
    mockGenerateRemoveDetachedWorkerWorkflow(...args),
}));

import { azureGenerateCiWorkflows } from './generate-ci-workflows';

describe('azureGenerateCiWorkflows', () => {
  const mockCIConfig = {
    provider: 'github',
    environments: ['dev', 'prod'],
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mocks.findProjectRoot.mockReturnValue('/test/project');
    mocks.isFile.mockReturnValue(true);
    mocks.readJsonFile.mockReturnValue(mockCIConfig);
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs' },
        { name: 'frontend', type: 'nextjs' },
      ],
    });
    mockGeneratePrWorkflow.mockReturnValue('# pr.yml content');
    mockGenerateDeployWorkflow.mockReturnValue('# deploy.yml content');
    mockGenerateDeployServicesWorkflow.mockReturnValue(
      '# deploy-services.yml content',
    );
    mockGenerateDeployInfraWorkflow.mockReturnValue(
      '# deploy-infra.yml content',
    );
    mockGenerateDeployKongWorkflow.mockReturnValue('# deploy-kong.yml content');
    mockGenerateDeployScheduledJobsWorkflow.mockReturnValue(
      '# deploy-scheduled-jobs.yml content',
    );
    mockGenerateRemoveServiceWorkflow.mockReturnValue(
      '# remove-service.yml content',
    );
    mockGenerateRemoveDetachedWorkerWorkflow.mockReturnValue(
      '# remove-detached-worker.yml content',
    );
  });

  describe('ci.json validation', () => {
    it('should throw when ci.json does not exist', async () => {
      mocks.isFile.mockReturnValue(false);

      await expect(azureGenerateCiWorkflows()).rejects.toThrow(mocks.CliError);
    });

    it('should throw when ci.json is invalid', async () => {
      mocks.readJsonFile.mockReturnValue(null);

      await expect(azureGenerateCiWorkflows()).rejects.toThrow(mocks.CliError);
    });

    it('should load ci.json from .tsdevstack directory', async () => {
      await azureGenerateCiWorkflows();

      expect(mocks.readJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('ci.json'),
      );
    });
  });

  describe('workflow generation', () => {
    it('should generate PR workflow', async () => {
      await azureGenerateCiWorkflows();

      expect(mockGeneratePrWorkflow).toHaveBeenCalled();
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('pr.yml'),
        '# pr.yml content',
      );
    });

    it('should generate deploy workflow with ci config', async () => {
      await azureGenerateCiWorkflows();

      expect(mockGenerateDeployWorkflow).toHaveBeenCalledWith(mockCIConfig, {
        npmAuth: false,
      });
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('deploy.yml'),
        '# deploy.yml content',
      );
    });

    it('should generate deploy-services workflow with services', async () => {
      await azureGenerateCiWorkflows();

      expect(mockGenerateDeployServicesWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        expect.arrayContaining([
          expect.objectContaining({ name: 'auth-service' }),
          expect.objectContaining({ name: 'frontend' }),
        ]),
        { npmAuth: false },
      );
    });

    it('should generate all infrastructure workflows', async () => {
      await azureGenerateCiWorkflows();

      expect(mockGenerateDeployInfraWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        { npmAuth: false },
      );
      expect(mockGenerateDeployKongWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        { npmAuth: false },
      );
      expect(mockGenerateDeployScheduledJobsWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        { npmAuth: false },
      );
    });

    it('should generate removal workflows', async () => {
      await azureGenerateCiWorkflows();

      expect(mockGenerateRemoveServiceWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        { npmAuth: false },
      );
      expect(mockGenerateRemoveDetachedWorkerWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        { npmAuth: false },
      );
    });

    it('should ensure workflows directory exists', async () => {
      await azureGenerateCiWorkflows();

      expect(mocks.ensureDirectory).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows'),
      );
    });

    it('should not generate deploy-lb workflow', async () => {
      await azureGenerateCiWorkflows();

      const writeTextCalls = mocks.writeTextFile.mock.calls.map(
        (c: unknown[]) => c[0],
      );
      const hasDeployLb = writeTextCalls.some((path: unknown) =>
        (path as string).includes('deploy-lb.yml'),
      );
      expect(hasDeployLb).toBe(false);
    });
  });

  describe('logging', () => {
    it('should log each workflow file created', async () => {
      await azureGenerateCiWorkflows();

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('pr.yml'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('deploy.yml'),
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('deploy-services.yml'),
      );
    });
  });

  describe('framework config integration', () => {
    it('should load services from framework config', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [
          { name: 'api-service', type: 'nestjs' },
          { name: 'worker-service', type: 'nestjs' },
          { name: 'frontend', type: 'nextjs' },
        ],
      });

      await azureGenerateCiWorkflows();

      expect(mockGenerateDeployServicesWorkflow).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({ name: 'api-service' }),
          expect.objectContaining({ name: 'worker-service' }),
          expect.objectContaining({ name: 'frontend' }),
        ]),
        { npmAuth: false },
      );
    });
  });
});
