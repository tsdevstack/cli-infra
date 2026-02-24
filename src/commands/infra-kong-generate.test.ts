import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

// Add additional mocks to context
const mockHasAuthTemplate = rs.fn();
const mockParseOpenApiSecurity = rs.fn();
const mockGenerateSecurityBasedServices = rs.fn();
const mockMergeKongConfigs = rs.fn();
const mockReadYamlFile = rs.fn();
const mockEnsureDirectory = rs.fn();
const mockWriteTextFile = rs.fn();
const mockReadJsonFile = rs.fn();

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    hasAuthTemplate: (...args: unknown[]) => mockHasAuthTemplate(...args),
    parseOpenApiSecurity: (...args: unknown[]) =>
      mockParseOpenApiSecurity(...args),
    generateSecurityBasedServices: (...args: unknown[]) =>
      mockGenerateSecurityBasedServices(...args),
    mergeKongConfigs: (...args: unknown[]) => mockMergeKongConfigs(...args),
    readYamlFile: (...args: unknown[]) => mockReadYamlFile(...args),
    ensureDirectory: (...args: unknown[]) => mockEnsureDirectory(...args),
    writeTextFile: (...args: unknown[]) => mockWriteTextFile(...args),
    readJsonFile: (...args: unknown[]) => mockReadJsonFile(...args),
  })),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockExecSync = rs.fn();
rs.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

rs.mock('js-yaml', () => ({
  default: {
    dump: rs.fn((obj) => JSON.stringify(obj)),
  },
}));

const mockSetupInfraCommand = rs.fn();
rs.mock('../utils/setup/setup-infra-command', () => ({
  setupInfraCommand: (...args: unknown[]) => mockSetupInfraCommand(...args),
}));

import { infraKongGenerate } from './infra-kong-generate';

describe('infraKongGenerate', () => {
  const mockCredentials = {
    project_id: 'gcp-project-123',
    region: 'us-central1',
  };

  const mockGCPContext = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    provider: 'gcp' as const,
    targetEnv: 'prod',
    credentials: mockCredentials,
    runningInCI: false,
  };

  beforeEach(() => {
    rs.resetAllMocks();
    mockSetupInfraCommand.mockResolvedValue(mockGCPContext);
    mocks.isFile.mockReturnValue(false);
    mockHasAuthTemplate.mockReturnValue(true);
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs', globalPrefix: 'auth' },
        { name: 'offers-service', type: 'nestjs', globalPrefix: 'offers' },
      ],
    });
    // isFile returns true for package.json and openapi.json paths
    mocks.isFile.mockImplementation(
      (p: string) => p.includes('package.json') || p.includes('openapi.json'),
    );
    mockReadJsonFile.mockReturnValue({
      scripts: { 'docs:generate': 'generate' },
    });
    mockParseOpenApiSecurity.mockReturnValue({
      serviceName: 'auth-service',
      groupedRoutes: { public: ['/health'] },
    });
    mockGenerateSecurityBasedServices.mockReturnValue([
      {
        name: 'auth-service',
        url: '${AUTH_SERVICE_URL}',
        routes: [{ paths: ['/auth/health'] }],
      },
    ]);
  });

  describe('context setup', () => {
    it('should set up infra command', async () => {
      await infraKongGenerate({});

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        {},
        'infra:generate-kong',
      );
    });

    it('should pass env option', async () => {
      await infraKongGenerate({ env: 'staging' });

      expect(mockSetupInfraCommand).toHaveBeenCalledWith(
        { env: 'staging' },
        'infra:generate-kong',
      );
    });
  });

  describe('custom config escape hatch', () => {
    it('should use kong.custom.yml when present', async () => {
      mocks.isFile.mockImplementation((p: string) =>
        p.includes('kong.custom.yml'),
      );
      mockReadYamlFile.mockReturnValue({
        _format_version: '3.0',
        services: [],
      });

      await infraKongGenerate({});

      expect(mockWriteTextFile).toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('kong.custom.yml detected'),
      );
    });
  });

  describe('service filtering', () => {
    it('should only process NestJS services', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [
          { name: 'auth-service', type: 'nestjs' },
          { name: 'frontend', type: 'nextjs' },
        ],
      });

      await infraKongGenerate({});

      // Should only generate spec for auth-service
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('auth-service'),
        expect.anything(),
      );
    });

    it('should warn when no NestJS services found', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [{ name: 'frontend', type: 'nextjs' }],
      });

      await infraKongGenerate({});

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No NestJS services found'),
      );
    });
  });

  describe('auth template handling', () => {
    it('should throw when auth template used but no auth service', async () => {
      mockHasAuthTemplate.mockReturnValue(true);
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [{ name: 'offers-service', type: 'nestjs' }],
      });

      await expect(infraKongGenerate({})).rejects.toThrow(mocks.CliError);
    });

    it('should use OIDC when no auth template', async () => {
      mockHasAuthTemplate.mockReturnValue(false);

      await infraKongGenerate({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('OIDC'),
      );
    });
  });

  describe('output', () => {
    it('should create output directory', async () => {
      await infraKongGenerate({});

      expect(mockEnsureDirectory).toHaveBeenCalledWith(
        expect.stringContaining('infrastructure/kong/prod'),
      );
    });

    it('should write kong.yml', async () => {
      await infraKongGenerate({});

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringContaining('kong.yml'),
        expect.anything(),
      );
    });
  });

  describe('logging', () => {
    it('should log completion', async () => {
      await infraKongGenerate({});

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        expect.stringContaining('Kong configuration generated'),
      );
    });
  });
});
