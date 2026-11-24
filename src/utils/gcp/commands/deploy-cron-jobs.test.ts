import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockDeployCronJob = rs.fn();
rs.mock('./deploy-cron-job', () => ({
  gcpDeployCronJob: (...args: unknown[]) => mockDeployCronJob(...args),
}));

const mockGetDeployedImage = rs.fn();
rs.mock('./get-deployed-cloud-run-image', () => ({
  getDeployedCloudRunImage: (...args: unknown[]) =>
    mockGetDeployedImage(...args),
}));

const mockSetSchedulerInvokerBindings = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildGcpTerraformEnv: rs.fn(() => ({})),
  buildGcpCloudRunName: (project: string, name: string, naming: string) =>
    naming === 'unique' ? `${project}-${name}` : name,
  buildGcpSchedulerAccountEmail: (project: string, projectId: string) =>
    `${project}-scheduler@${projectId}.iam.gserviceaccount.com`,
  setSchedulerInvokerBindings: (...args: unknown[]) =>
    mockSetSchedulerInvokerBindings(...args),
  calculatePoolSize: rs.fn(() => ({
    poolMax: 7,
    totalUsable: 90,
    totalInstances: 12,
    dbConnections: 100,
  })),
  getTotalWorkerMaxInstances: rs.fn(() => 3),
  CRON_JOB_TIMEOUT: { gcp: { min: 1, max: 604740, default: 600 } },
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: rs.fn(() => ({})) }));
const mockServiceAccountExists = rs.fn();
rs.mock('../discovery/service-account-exists', () => ({
  serviceAccountExists: (...args: unknown[]) =>
    mockServiceAccountExists(...args),
}));
rs.mock('../terraform', () => ({
  getTerraformOutput: rs.fn(
    (_dir: string, name: string) =>
      ({
        artifact_registry_url: 'europe-west1-docker.pkg.dev/gcp-shop/shop',
        vpc_id: 'vpc',
        subnet_id: 'subnet',
      })[name],
  ),
  getTerraformOutputJson: rs.fn(() => ({
    'auth-service': 'shop-auth-service@gcp-shop.iam.gserviceaccount.com',
  })),
}));
rs.mock('../../deploy/get-total-service-max-instances', () => ({
  getTotalServiceMaxInstances: rs.fn(() => 9),
}));
rs.mock('../../deploy/warn-if-small-database-pool', () => ({
  warnIfSmallDatabasePool: rs.fn(),
}));
rs.mock('../../infrastructure/load-infrastructure-config', () => ({
  loadInfrastructureConfig: rs.fn(() => ({ version: '1.0.0', dev: {} })),
}));
rs.mock('../../infrastructure/get-service-config', () => ({
  getServiceConfig: rs.fn(() => ({ logLevel: 'info' })),
}));
rs.mock('../../infrastructure/get-trace-sample-rate', () => ({
  getTraceSampleRate: rs.fn(() => 1),
}));

import { gcpDeployCronJobs } from './deploy-cron-jobs';

const ctx = {
  projectRoot: '/project',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    project_id: 'gcp-shop',
    region: 'europe-west1',
    client_email: 'x@gcp-shop.iam.gserviceaccount.com',
    private_key: 'k',
  },
  runningInCI: false,
};

const config = {
  project: { name: 'shop', version: '1.0.0' },
  cloud: { provider: 'gcp' as const },
  services: [
    { name: 'auth-service', type: 'nestjs', port: 3001, hasDatabase: true },
    { name: 'bff-service', type: 'nestjs', port: 3002 },
    { name: 'frontend', type: 'nextjs', port: 4000 },
  ],
};

const job = {
  name: 'usage-report',
  type: 'cron' as const,
  schedule: '0 3 * * *',
  targetService: 'auth-service',
};

describe('gcpDeployCronJobs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockDeployCronJob.mockResolvedValue({ jobName: 'shop-cron-usage-report' });
    mockGetDeployedImage.mockResolvedValue('registry/auth-service:deployed');
    mockServiceAccountExists.mockResolvedValue({ exists: true });
    mockSetSchedulerInvokerBindings.mockResolvedValue(undefined);
  });

  it('should do nothing without jobs', async () => {
    await gcpDeployCronJobs(ctx, config, [], {
      naming: 'unique',
      commandName: 'x',
    });
    expect(mockDeployCronJob).not.toHaveBeenCalled();
    expect(mockServiceAccountExists).not.toHaveBeenCalled();
  });

  describe("The scheduler account's run.invoker", () => {
    it('should let the scheduler account start each job right after it is deployed', async () => {
      const order: string[] = [];
      mockDeployCronJob.mockImplementation(async () => {
        order.push('deploy');
        return { jobName: 'shop-cron-usage-report' };
      });
      mockSetSchedulerInvokerBindings.mockImplementation(async () => {
        order.push('grant');
      });

      await gcpDeployCronJobs(ctx, config, [job], {
        naming: 'unique',
        imageTag: 'abc',
        commandName: 'infra:deploy-services',
      });

      expect(mockServiceAccountExists).toHaveBeenCalledWith({
        serviceAccountEmail: 'shop-scheduler@gcp-shop.iam.gserviceaccount.com',
        projectId: 'gcp-shop',
        credentials: ctx.credentials,
      });
      expect(mockSetSchedulerInvokerBindings).toHaveBeenCalledWith(
        {},
        {
          projectId: 'gcp-shop',
          projectName: 'shop',
          region: 'europe-west1',
          targetServices: [],
          targetJobs: ['shop-cron-usage-report'],
          credentials: ctx.credentials,
        },
      );
      expect(order).toEqual(['deploy', 'grant']);
      expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('should point at deploy-schedulers when the scheduler account does not exist yet', async () => {
      mockServiceAccountExists.mockResolvedValue({ exists: false });

      await gcpDeployCronJobs(ctx, config, [job], {
        naming: 'unique',
        imageTag: 'abc',
        commandName: 'infra:deploy-services',
      });

      expect(mockDeployCronJob).toHaveBeenCalled();
      expect(mockSetSchedulerInvokerBindings).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        "Cloud Scheduler can't start usage-report yet: its account shop-scheduler@gcp-shop.iam.gserviceaccount.com doesn't exist",
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        '  Run npx tsdevstack infra:deploy-schedulers --env dev: it creates the account with the schedules and lets it start the jobs',
      );
    });

    it('should still try the grant when the account check fails', async () => {
      mockServiceAccountExists.mockResolvedValue({
        exists: false,
        error: 'iam.serviceAccounts.get denied',
      });

      await gcpDeployCronJobs(ctx, config, [job], {
        naming: 'unique',
        imageTag: 'abc',
        commandName: 'x',
      });

      expect(mockSetSchedulerInvokerBindings).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ targetJobs: ['shop-cron-usage-report'] }),
      );
    });

    it('should grant nothing for a job that failed to deploy', async () => {
      mockDeployCronJob.mockRejectedValue(new Error('quota exceeded'));

      await expect(
        gcpDeployCronJobs(ctx, config, [job], {
          naming: 'unique',
          imageTag: 'abc',
          commandName: 'x',
        }),
      ).rejects.toMatchObject({ message: 'Failed to deploy 1 cron job(s)' });
      expect(mockSetSchedulerInvokerBindings).not.toHaveBeenCalled();
    });
  });

  it("should deploy each job with the service's image at the given tag, its account and the defaults", async () => {
    await gcpDeployCronJobs(ctx, config, [job], {
      naming: 'unique',
      imageTag: 'abc123',
      commandName: 'infra:deploy-services',
    });

    expect(mockGetDeployedImage).not.toHaveBeenCalled();
    expect(mockDeployCronJob).toHaveBeenCalledWith(
      expect.objectContaining({
        projectName: 'shop',
        naming: 'unique',
        job,
        service: config.services[0],
        imageUri:
          'europe-west1-docker.pkg.dev/gcp-shop/shop/auth-service:abc123',
        vpcNetwork: 'vpc',
        vpcSubnet: 'subnet',
        serviceAccount: 'shop-auth-service@gcp-shop.iam.gserviceaccount.com',
        poolMax: 7,
        logLevel: 'info',
        cpu: '1',
        memory: '2Gi',
        timeoutSeconds: 600,
      }),
    );
    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining('usage-report deployed (shop-cron-usage-report'),
    );
  });

  it("should take the entry's timeout, cpu and memory", async () => {
    await gcpDeployCronJobs(
      ctx,
      config,
      [{ ...job, timeout: 1800, cpu: '2', memory: '4Gi' }],
      { naming: 'unique', imageTag: 'abc', commandName: 'x' },
    );

    expect(mockDeployCronJob).toHaveBeenCalledWith(
      expect.objectContaining({
        cpu: '2',
        memory: '4Gi',
        timeoutSeconds: 1800,
      }),
    );
  });

  it('should use the image the service runs when no tag is given', async () => {
    await gcpDeployCronJobs(ctx, config, [job], {
      naming: 'unique',
      commandName: 'x',
    });

    expect(mockGetDeployedImage).toHaveBeenCalledWith(
      ctx.credentials,
      'shop-auth-service',
    );
    expect(mockDeployCronJob).toHaveBeenCalledWith(
      expect.objectContaining({ imageUri: 'registry/auth-service:deployed' }),
    );
  });

  it('should stop with the deploy-the-service hint when the service is not deployed', async () => {
    mockGetDeployedImage.mockResolvedValue(undefined);

    await expect(
      gcpDeployCronJobs(ctx, config, [job], {
        naming: 'unique',
        commandName: 'infra:deploy-schedulers',
      }),
    ).rejects.toMatchObject({
      message: 'Failed to deploy 1 cron job(s)',
      hint: expect.stringContaining(
        'auth-service is not deployed yet: npx tsdevstack infra:deploy-services --env dev --service auth-service',
      ),
    });
    expect(mockDeployCronJob).not.toHaveBeenCalled();
  });

  it('should refuse a job whose service is not NestJS or has no account', async () => {
    await expect(
      gcpDeployCronJobs(
        ctx,
        config,
        [
          { ...job, name: 'a', targetService: 'frontend' },
          { ...job, name: 'b', targetService: 'bff-service' },
        ],
        { naming: 'unique', imageTag: 'abc', commandName: 'x' },
      ),
    ).rejects.toMatchObject({
      message: 'Failed to deploy 2 cron job(s)',
      hint: expect.stringContaining('No service account for bff-service'),
    });
    expect(mockDeployCronJob).not.toHaveBeenCalled();
  });
});
