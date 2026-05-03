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
const mockGenerateDeployLbWorkflow = rs.fn();
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
  generateDeployLbWorkflow: (...args: unknown[]) =>
    mockGenerateDeployLbWorkflow(...args),
  generateDeployScheduledJobsWorkflow: (...args: unknown[]) =>
    mockGenerateDeployScheduledJobsWorkflow(...args),
  generateRemoveServiceWorkflow: (...args: unknown[]) =>
    mockGenerateRemoveServiceWorkflow(...args),
  generateRemoveDetachedWorkerWorkflow: (...args: unknown[]) =>
    mockGenerateRemoveDetachedWorkerWorkflow(...args),
}));

import { gcpGenerateCiWorkflows } from './generate-ci-workflows';

describe('gcpGenerateCiWorkflows', () => {
  const mockCIConfig = {
    provider: 'gcp',
    project: 'my-app',
    environments: ['prod'],
    registry: 'us-central1-docker.pkg.dev/gcp-project-123/my-app',
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
    mockGenerateDeployLbWorkflow.mockReturnValue('# deploy-lb.yml content');
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

      await expect(gcpGenerateCiWorkflows()).rejects.toThrow(mocks.CliError);
    });

    it('should throw when ci.json is invalid', async () => {
      mocks.readJsonFile.mockReturnValue(null);

      await expect(gcpGenerateCiWorkflows()).rejects.toThrow(mocks.CliError);
    });

    it('should load ci.json from .tsdevstack directory', async () => {
      await gcpGenerateCiWorkflows();

      expect(mocks.readJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('ci.json'),
      );
    });
  });

  describe('workflow generation', () => {
    it('should generate PR workflow', async () => {
      await gcpGenerateCiWorkflows();

      expect(mockGeneratePrWorkflow).toHaveBeenCalled();
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('pr.yml'),
        '# pr.yml content',
      );
    });

    it('should generate deploy workflow with ci config', async () => {
      await gcpGenerateCiWorkflows();

      expect(mockGenerateDeployWorkflow).toHaveBeenCalledWith(mockCIConfig, {
        npmAuth: false,
      });
      expect(mocks.writeTextFile).toHaveBeenCalledWith(
        expect.stringContaining('deploy.yml'),
        '# deploy.yml content',
      );
    });

    it('should generate deploy-services workflow with services', async () => {
      await gcpGenerateCiWorkflows();

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
      await gcpGenerateCiWorkflows();

      expect(mockGenerateDeployInfraWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        { npmAuth: false },
      );
      expect(mockGenerateDeployKongWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        { npmAuth: false },
      );
      expect(mockGenerateDeployLbWorkflow).toHaveBeenCalledWith(mockCIConfig, {
        npmAuth: false,
      });
      expect(mockGenerateDeployScheduledJobsWorkflow).toHaveBeenCalledWith(
        mockCIConfig,
        { npmAuth: false },
      );
    });

    it('should generate removal workflows', async () => {
      await gcpGenerateCiWorkflows();

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
      await gcpGenerateCiWorkflows();

      expect(mocks.ensureDirectory).toHaveBeenCalledWith(
        expect.stringContaining('.github/workflows'),
      );
    });
  });

  describe('logging', () => {
    it('should log each workflow file created', async () => {
      await gcpGenerateCiWorkflows();

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

      await gcpGenerateCiWorkflows();

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
