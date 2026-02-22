import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from 'tsdevstack/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

rs.mock('../../../commands/infra-docker-generate', () => ({
  infraDockerGenerate: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-build', () => ({
  infraDockerBuild: rs.fn(),
}));

rs.mock('../../../commands/infra-docker-push', () => ({
  infraDockerPush: rs.fn(),
}));

rs.mock('../../../commands/infra-db-migrate-run', () => ({
  infraDbMigrateRun: rs.fn(),
}));

rs.mock('../../../commands/infra-worker-deploy', () => ({
  infraWorkerDeploy: rs.fn(),
}));

rs.mock('./deploy-service', () => ({
  gcpDeployService: rs.fn(),
}));

rs.mock('../deploy-spa-service', () => ({
  deploySpaService: rs.fn(),
}));

rs.mock('../discovery', () => ({
  discoverDeployedServices: rs.fn(),
}));

const mockConfigureDockerAuth = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: rs.fn(() => ({ GOOGLE_PROJECT: 'my-gcp-project' })),
  checkTopologyDrift: rs.fn(),
  configureDockerAuth: (...args: unknown[]) => mockConfigureDockerAuth(...args),
  isPoolRelevant: rs.fn(),
  parseServiceFilter: rs.fn((filter?: string) => {
    if (!filter) return undefined;
    const names = filter
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    return names.length > 0 ? names : undefined;
  }),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(
    () => 'us-central1-docker.pkg.dev/my-gcp-project/my-app',
  ),
}));

rs.mock('p-map', () => ({
  default: rs.fn(
    async (items: unknown[], fn: (item: unknown) => Promise<void>) => {
      for (const item of items) {
        await fn(item);
      }
    },
  ),
}));

import { gcpDeployServices } from './deploy-services';
import { infraDockerGenerate } from '../../../commands/infra-docker-generate';
import { infraDockerBuild } from '../../../commands/infra-docker-build';
import { infraDockerPush } from '../../../commands/infra-docker-push';
import { infraDbMigrateRun } from '../../../commands/infra-db-migrate-run';
import { infraWorkerDeploy } from '../../../commands/infra-worker-deploy';
import { gcpDeployService } from './deploy-service';
import { deploySpaService } from '../deploy-spa-service';
import { discoverDeployedServices } from '../discovery';
import { checkTopologyDrift, isPoolRelevant } from '@tsdevstack/infra-core';

describe('gcpDeployServices', () => {
  const mockCtx = {
    projectRoot: '/test/project',
    projectName: 'my-app',
    targetEnv: 'dev',
    credentials: {
      project_id: 'my-gcp-project',
      client_email: 'sa@my-gcp-project.iam.gserviceaccount.com',
      region: 'us-central1',
    },
    runningInCI: false,
  };

  const mockConfig = {
    services: [
      { name: 'auth-service', type: 'nestjs', hasDatabase: true },
      { name: 'frontend', type: 'nextjs' },
      { name: 'landing', type: 'spa' },
    ],
  };

  beforeEach(() => {
    rs.resetAllMocks();

    mocks.loadFrameworkConfig.mockReturnValue(mockConfig);
    mockConfigureDockerAuth.mockResolvedValue(undefined);
    rs.mocked(infraDockerGenerate).mockResolvedValue(undefined);
    rs.mocked(infraDockerBuild).mockResolvedValue(undefined);
    rs.mocked(infraDockerPush).mockResolvedValue(undefined);
    rs.mocked(infraDbMigrateRun).mockResolvedValue(undefined);
    rs.mocked(infraWorkerDeploy).mockResolvedValue(undefined);
    rs.mocked(gcpDeployService).mockResolvedValue(undefined);
    rs.mocked(deploySpaService).mockResolvedValue(undefined);
    rs.mocked(isPoolRelevant).mockReturnValue(false);
  });

  it('should deploy all service types when no filter', async () => {
    await gcpDeployServices(mockCtx, {});

    // Docker services: auth-service + frontend
    expect(gcpDeployService).toHaveBeenCalledTimes(2);
    // SPA services: landing
    expect(deploySpaService).toHaveBeenCalledTimes(1);
  });

  it('should generate Dockerfiles by default', async () => {
    await gcpDeployServices(mockCtx, {});

    expect(infraDockerGenerate).toHaveBeenCalledTimes(2);
    expect(infraDockerGenerate).toHaveBeenCalledWith({
      service: 'auth-service',
    });
    expect(infraDockerGenerate).toHaveBeenCalledWith({ service: 'frontend' });
  });

  it('should skip Dockerfile generation when skipGenerate is true', async () => {
    await gcpDeployServices(mockCtx, { skipGenerate: true });

    expect(infraDockerGenerate).not.toHaveBeenCalled();
  });

  it('should build Docker images for docker services', async () => {
    await gcpDeployServices(mockCtx, {});

    expect(infraDockerBuild).toHaveBeenCalledTimes(2);
  });

  it('should authenticate Docker once and pass skipAuth to build and push', async () => {
    await gcpDeployServices(mockCtx, {});

    expect(mockConfigureDockerAuth).toHaveBeenCalledTimes(1);
    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
    expect(infraDockerPush).toHaveBeenCalledWith(
      expect.objectContaining({ skipAuth: true }),
    );
  });

  it('should push Docker images for docker services', async () => {
    await gcpDeployServices(mockCtx, {});

    expect(infraDockerPush).toHaveBeenCalledTimes(2);
  });

  it('should run migrations for services with databases', async () => {
    await gcpDeployServices(mockCtx, {});

    expect(infraDbMigrateRun).toHaveBeenCalledTimes(1);
    expect(infraDbMigrateRun).toHaveBeenCalledWith({
      env: 'dev',
      service: 'auth-service',
    });
  });

  it('should not run migrations for services without databases', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({
      services: [{ name: 'frontend', type: 'nextjs' }],
    });

    await gcpDeployServices(mockCtx, {});

    expect(infraDbMigrateRun).not.toHaveBeenCalled();
  });

  it('should deploy specific service when filter is set', async () => {
    await gcpDeployServices(mockCtx, { service: 'auth-service' });

    expect(gcpDeployService).toHaveBeenCalledTimes(1);
    expect(gcpDeployService).toHaveBeenCalledWith(
      expect.objectContaining({
        service: { name: 'auth-service', type: 'nestjs', hasDatabase: true },
      }),
    );
    expect(deploySpaService).not.toHaveBeenCalled();
  });

  it('should deploy SPA when specific spa service requested', async () => {
    await gcpDeployServices(mockCtx, { service: 'landing' });

    expect(deploySpaService).toHaveBeenCalledTimes(1);
    expect(gcpDeployService).not.toHaveBeenCalled();
  });

  it('should throw when specific service not found', async () => {
    await expect(
      gcpDeployServices(mockCtx, { service: 'nonexistent' }),
    ).rejects.toThrow('not found');
  });

  it('should pass custom tag through', async () => {
    await gcpDeployServices(mockCtx, { tag: 'v1.0.0' });

    expect(infraDockerBuild).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.0.0' }),
    );
    expect(infraDockerPush).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.0.0' }),
    );
    expect(gcpDeployService).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'v1.0.0' }),
    );
  });

  it('should log completion', async () => {
    await gcpDeployServices(mockCtx, {});

    expect(mocks.logger.complete).toHaveBeenCalledWith(
      'All services deployed successfully!',
    );
  });

  it('should warn when no deployable services found', async () => {
    mocks.loadFrameworkConfig.mockReturnValue({ services: [] });

    await gcpDeployServices(mockCtx, {});

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'No deployable services found',
    );
  });

  describe('topology check', () => {
    it('should check topology when deploying single pool-relevant service', async () => {
      rs.mocked(isPoolRelevant).mockReturnValue(true);
      rs.mocked(discoverDeployedServices).mockResolvedValue({
        success: true,
        services: [
          {
            name: 'auth-service',
            type: 'backend',
            status: 'running',
            resources: {
              hasDatabase: true,
              secretCount: 0,
              cloudRunService: true,
              spaBucket: false,
              hasServiceAccount: true,
            },
          },
        ],
      });

      await gcpDeployServices(mockCtx, { service: 'auth-service' });

      expect(discoverDeployedServices).toHaveBeenCalledWith(
        expect.objectContaining({
          projectName: 'my-app',
          projectId: 'my-gcp-project',
          region: 'us-central1',
          sqlInstanceName: 'my-app-postgres',
        }),
      );
      expect(checkTopologyDrift).toHaveBeenCalledWith({
        targetEnv: 'dev',
        deployedServices: expect.any(Array),
        configServices: mockConfig.services,
      });
    });

    it('should skip topology check for non-pool-relevant services', async () => {
      rs.mocked(isPoolRelevant).mockReturnValue(false);

      await gcpDeployServices(mockCtx, { service: 'frontend' });

      expect(discoverDeployedServices).not.toHaveBeenCalled();
      expect(checkTopologyDrift).not.toHaveBeenCalled();
    });

    it('should skip topology check when deploying all services', async () => {
      await gcpDeployServices(mockCtx, {});

      expect(discoverDeployedServices).not.toHaveBeenCalled();
      expect(checkTopologyDrift).not.toHaveBeenCalled();
    });

    it('should throw when discovery fails', async () => {
      rs.mocked(isPoolRelevant).mockReturnValue(true);
      rs.mocked(discoverDeployedServices).mockResolvedValue({
        success: false,
        services: [],
        error: 'Permission denied',
      });

      await expect(
        gcpDeployServices(mockCtx, { service: 'auth-service' }),
      ).rejects.toThrow(mocks.CliError);
    });
  });

  describe('worker deployment', () => {
    const configWithWorker = {
      services: [
        { name: 'auth-service', type: 'nestjs', hasDatabase: true },
        { name: 'auth-worker', type: 'worker', baseService: 'auth-service' },
        { name: 'landing', type: 'spa' },
      ],
    };

    beforeEach(() => {
      mocks.loadFrameworkConfig.mockReturnValue(configWithWorker);
    });

    it('should deploy coupled workers alongside their base service', async () => {
      await gcpDeployServices(mockCtx, {});

      expect(infraWorkerDeploy).toHaveBeenCalledWith({
        env: 'dev',
        worker: 'auth-worker',
        baseService: 'auth-service',
        tag: undefined,
      });
    });

    it('should pass custom tag to workers', async () => {
      await gcpDeployServices(mockCtx, { tag: 'v2.0.0' });

      expect(infraWorkerDeploy).toHaveBeenCalledWith(
        expect.objectContaining({ tag: 'v2.0.0' }),
      );
    });

    it('should not deploy workers when base service is not being deployed', async () => {
      mocks.loadFrameworkConfig.mockReturnValue({
        services: [
          { name: 'auth-service', type: 'nestjs', hasDatabase: true },
          { name: 'bff-worker', type: 'worker', baseService: 'bff-service' },
        ],
      });

      await gcpDeployServices(mockCtx, {});

      expect(infraWorkerDeploy).not.toHaveBeenCalled();
    });

    it('should skip workers when none exist', async () => {
      mocks.loadFrameworkConfig.mockReturnValue(mockConfig);

      await gcpDeployServices(mockCtx, {});

      expect(infraWorkerDeploy).not.toHaveBeenCalled();
    });
  });
});
