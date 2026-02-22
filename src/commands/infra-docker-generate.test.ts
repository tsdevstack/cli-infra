import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

// Add mock functions for context utilities
const mockEnsureDirectory = rs.fn();
const mockWriteTextFile = rs.fn();

rs.mock('../context', () => ({
  initContext: rs.fn(),
  getContext: rs.fn(() => ({
    ...(globalThis as unknown as { contextMocks: MockContext }).contextMocks,
    ensureDirectory: mockEnsureDirectory,
    writeTextFile: mockWriteTextFile,
  })),
  wrapCommand: rs.fn((fn: unknown) => fn),
}));

const mockGenerateNestJsDockerfile = rs.fn();
const mockGenerateNextJsDockerfile = rs.fn();
const mockGetServiceWorkspaceDeps = rs.fn();
const mockValidateNextjsStandalone = rs.fn();

rs.mock('../utils/docker', () => ({
  generateNestJsDockerfile: (...args: unknown[]) =>
    mockGenerateNestJsDockerfile(...args),
  generateNextJsDockerfile: (...args: unknown[]) =>
    mockGenerateNextJsDockerfile(...args),
  getServiceWorkspaceDeps: (...args: unknown[]) =>
    mockGetServiceWorkspaceDeps(...args),
  validateNextjsStandalone: (...args: unknown[]) =>
    mockValidateNextjsStandalone(...args),
}));

import { infraDockerGenerate } from './infra-docker-generate';

describe('infraDockerGenerate', () => {
  beforeEach(() => {
    rs.resetAllMocks();
    mockEnsureDirectory.mockClear();
    mockWriteTextFile.mockClear();
    mocks.findProjectRoot.mockReturnValue('/test/project');
    mocks.loadFrameworkConfig.mockReturnValue({
      project: { name: 'my-app' },
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'frontend', type: 'nextjs' },
        { name: 'scripts', type: 'scripts' },
      ],
    });
    mockGetServiceWorkspaceDeps.mockReturnValue(['@my-app/shared']);
    mockGenerateNestJsDockerfile.mockReturnValue('# NestJS Dockerfile');
    mockGenerateNextJsDockerfile.mockReturnValue('# Next.js Dockerfile');
  });

  describe('service filtering', () => {
    it('should only include deployable service types', async () => {
      await infraDockerGenerate({});

      // auth-service (nestjs) and frontend (nextjs) should be processed
      expect(mockWriteTextFile).toHaveBeenCalledTimes(2);
    });

    it('should skip non-deployable services', async () => {
      await infraDockerGenerate({});

      // scripts service should be skipped
      expect(mockWriteTextFile).not.toHaveBeenCalledWith(
        expect.stringContaining('scripts.Dockerfile'),
        expect.anything(),
      );
    });

    it('should filter by specific service name', async () => {
      await infraDockerGenerate({ service: 'auth-service' });

      expect(mockWriteTextFile).toHaveBeenCalledTimes(1);
      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringContaining('auth-service.Dockerfile'),
        expect.anything(),
      );
    });

    it('should throw when specified service not found', async () => {
      await expect(infraDockerGenerate({ service: 'unknown' })).rejects.toThrow(
        mocks.CliError,
      );
    });

    it('should throw when specified service not deployable', async () => {
      await expect(infraDockerGenerate({ service: 'scripts' })).rejects.toThrow(
        mocks.CliError,
      );
    });
  });

  describe('NestJS Dockerfile generation', () => {
    it('should generate NestJS Dockerfile', async () => {
      await infraDockerGenerate({ service: 'auth-service' });

      expect(mockGenerateNestJsDockerfile).toHaveBeenCalledWith({
        serviceName: 'auth-service',
        workspacePackages: ['@my-app/shared'],
        hasDatabase: true,
      });
    });

    it('should pass hasDatabase flag', async () => {
      await infraDockerGenerate({ service: 'auth-service' });

      expect(mockGenerateNestJsDockerfile).toHaveBeenCalledWith(
        expect.objectContaining({ hasDatabase: true }),
      );
    });
  });

  describe('Next.js Dockerfile generation', () => {
    it('should validate standalone output', async () => {
      await infraDockerGenerate({ service: 'frontend' });

      expect(mockValidateNextjsStandalone).toHaveBeenCalledWith(
        '/test/project',
        'frontend',
      );
    });

    it('should generate Next.js Dockerfile', async () => {
      await infraDockerGenerate({ service: 'frontend' });

      expect(mockGenerateNextJsDockerfile).toHaveBeenCalledWith({
        serviceName: 'frontend',
        workspacePackages: ['@my-app/shared'],
      });
    });
  });

  describe('output directory', () => {
    it('should create docker output directory', async () => {
      await infraDockerGenerate({});

      expect(mockEnsureDirectory).toHaveBeenCalledWith(
        expect.stringContaining('infrastructure/docker'),
      );
    });

    it('should write files to docker directory', async () => {
      await infraDockerGenerate({});

      expect(mockWriteTextFile).toHaveBeenCalledWith(
        expect.stringContaining(
          'infrastructure/docker/auth-service.Dockerfile',
        ),
        expect.anything(),
      );
    });
  });

  describe('workspace dependencies', () => {
    it('should get workspace dependencies for each service', async () => {
      await infraDockerGenerate({});

      expect(mockGetServiceWorkspaceDeps).toHaveBeenCalledWith(
        '/test/project',
        'auth-service',
      );
      expect(mockGetServiceWorkspaceDeps).toHaveBeenCalledWith(
        '/test/project',
        'frontend',
      );
    });
  });

  describe('no deployable services', () => {
    it('should warn when no deployable services found', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        project: { name: 'my-app' },
        services: [{ name: 'scripts', type: 'scripts' }],
      });

      await infraDockerGenerate({});

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No deployable services found'),
      );
    });
  });

  describe('logging', () => {
    it('should log success for each Dockerfile', async () => {
      await infraDockerGenerate({});

      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('auth-service.Dockerfile'),
      );
      expect(mocks.logger.success).toHaveBeenCalledWith(
        expect.stringContaining('frontend.Dockerfile'),
      );
    });

    it('should log skipped services', async () => {
      await infraDockerGenerate({});

      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipped'),
      );
    });

    it('should log completion', async () => {
      await infraDockerGenerate({});

      expect(mocks.logger.complete).toHaveBeenCalledWith(
        expect.stringContaining('Dockerfiles generated'),
      );
    });
  });
});
