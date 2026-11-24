import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockRegister = rs.fn();
rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: rs.fn(() => ({})),
  registerEcsTaskDefinitionRevision: (...args: unknown[]) =>
    mockRegister(...args),
  CRON_JOB_NAME_ENV: 'CRON_JOB_NAME',
  CRON_JOB_TIMEOUT_ENV: 'CRON_JOB_TIMEOUT',
  CRON_JOB_TIMEOUT: { aws: { min: 1, max: 86400, default: 600 } },
  CRON_JOB_NAME_PREFIX: 'cron-',
}));
rs.mock('../../build-runtime', () => ({ buildRuntime: rs.fn(() => ({})) }));
const mockGetTerraformOutput = rs.fn();
rs.mock('../terraform', () => ({
  getTerraformOutput: (...args: unknown[]) => mockGetTerraformOutput(...args),
}));
const mockGetDeployedImage = rs.fn();
rs.mock('./get-deployed-ecs-image', () => ({
  getDeployedEcsImage: (...args: unknown[]) => mockGetDeployedImage(...args),
}));
const mockPointSchedule = rs.fn();
rs.mock('./point-schedule-at-task-definition', () => ({
  pointScheduleAtTaskDefinition: (...args: unknown[]) =>
    mockPointSchedule(...args),
}));

import { awsDeployCronJobs } from './deploy-cron-jobs';

const ctx = {
  projectRoot: '/project',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    region: 'eu-west-1',
    accessKeyId: 'k',
    secretAccessKey: 's',
    accountId: '123456789012',
  },
  runningInCI: false,
};
const config = {
  project: { name: 'shop', version: '1.0.0' },
  cloud: { provider: 'aws' as const },
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
const revisionArn =
  'arn:aws:ecs:eu-west-1:123456789012:task-definition/shop-cron-usage-report:7';

describe('awsDeployCronJobs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    mockGetTerraformOutput.mockImplementation(
      (_dir: string, name: string) =>
        ({
          ecr_repository_url:
            '123456789012.dkr.ecr.eu-west-1.amazonaws.com/shop',
          ecs_cluster_name: 'shop-cluster',
        })[name],
    );
    mockRegister.mockResolvedValue({
      taskDefinitionArn: revisionArn,
      containerName: 'cron-usage-report',
    });
    mockPointSchedule.mockResolvedValue(true);
    mockGetDeployedImage.mockResolvedValue('repo/auth-service:deployed');
  });

  it('should do nothing without jobs', async () => {
    await expect(
      awsDeployCronJobs(ctx, config, [], { commandName: 'x' }),
    ).resolves.toEqual({ deployed: [], skipped: [] });
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockGetTerraformOutput).not.toHaveBeenCalled();
  });

  it("should register a revision with the tag's image, the job's name and timeout and DATABASE_URL, then point the schedule at it", async () => {
    const order: string[] = [];
    mockRegister.mockImplementation(async () => {
      order.push('register');
      return { taskDefinitionArn: revisionArn, containerName: 'c' };
    });
    mockPointSchedule.mockImplementation(async () => {
      order.push('schedule');
      return true;
    });

    await awsDeployCronJobs(ctx, config, [{ ...job, timeout: 1800 }], {
      imageTag: 'abc123',
      commandName: 'infra:deploy-services',
    });

    expect(mockGetDeployedImage).not.toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledWith(
      {},
      {
        credentials: ctx.credentials,
        family: 'shop-cron-usage-report',
        imageUri:
          '123456789012.dkr.ecr.eu-west-1.amazonaws.com/shop/auth-service:abc123',
        environment: {
          CRON_JOB_NAME: 'usage-report',
          CRON_JOB_TIMEOUT: '1800',
        },
        secrets: {
          DATABASE_URL:
            'arn:aws:secretsmanager:eu-west-1:123456789012:secret:shop-auth-service-DATABASE_URL',
        },
      },
    );
    expect(mockPointSchedule).toHaveBeenCalledWith({
      credentials: ctx.credentials,
      scheduleName: 'shop-auth-service-usage-report',
      taskDefinitionArn: revisionArn,
    });
    expect(order).toEqual(['register', 'schedule']);
    expect(mocks.logger.success).toHaveBeenCalledWith(
      expect.stringContaining(
        'usage-report deployed (shop-cron-usage-report:7',
      ),
    );
  });

  it('should inject no secret for a service without a database, and take the default timeout', async () => {
    await awsDeployCronJobs(
      ctx,
      config,
      [{ ...job, targetService: 'bff-service' }],
      { imageTag: 'abc', commandName: 'x' },
    );

    expect(mockRegister).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        environment: { CRON_JOB_NAME: 'usage-report', CRON_JOB_TIMEOUT: '600' },
        secrets: undefined,
      }),
    );
  });

  it('should use the image the service runs when no tag is given', async () => {
    await awsDeployCronJobs(ctx, config, [job], { commandName: 'x' });

    expect(mockGetDeployedImage).toHaveBeenCalledWith(
      ctx.credentials,
      'shop-cluster',
      'auth-service',
    );
    expect(mockRegister).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ imageUri: 'repo/auth-service:deployed' }),
    );
  });

  it('should stop with the deploy-the-service hint when the service is not deployed', async () => {
    mockGetDeployedImage.mockResolvedValue(undefined);

    await expect(
      awsDeployCronJobs(ctx, config, [job], {
        commandName: 'infra:deploy-schedulers',
      }),
    ).rejects.toMatchObject({
      message: 'Failed to deploy 1 cron job(s)',
      hint: 'usage-report: auth-service is not deployed yet: npx tsdevstack infra:deploy-services --env dev --service auth-service',
    });
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("should point at deploy-schedulers when Terraform's task definition or schedule is missing", async () => {
    mockRegister.mockResolvedValueOnce(undefined);
    await expect(
      awsDeployCronJobs(ctx, config, [job], {
        imageTag: 'abc',
        commandName: 'x',
      }),
    ).rejects.toMatchObject({
      hint: "usage-report: Its task definition shop-cron-usage-report doesn't exist yet: npx tsdevstack infra:deploy-schedulers --env dev",
    });
    expect(mockPointSchedule).not.toHaveBeenCalled();

    mockPointSchedule.mockResolvedValueOnce(false);
    await expect(
      awsDeployCronJobs(ctx, config, [job], {
        imageTag: 'abc',
        commandName: 'x',
      }),
    ).rejects.toMatchObject({
      hint: "usage-report: Its schedule shop-auth-service-usage-report doesn't exist yet: npx tsdevstack infra:deploy-schedulers --env dev",
    });
  });

  describe('A job not set up yet, in deploy-services (skipNotSetUp)', () => {
    it('should skip a job without its task definition, with the hint, and not fail', async () => {
      mockRegister.mockResolvedValueOnce(undefined);

      await expect(
        awsDeployCronJobs(ctx, config, [job], {
          imageTag: 'abc',
          commandName: 'infra:deploy-services',
          skipNotSetUp: true,
        }),
      ).resolves.toEqual({ deployed: [], skipped: ['usage-report'] });
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        "  usage-report: skipped, its task definition shop-cron-usage-report doesn't exist yet. npx tsdevstack infra:deploy-schedulers --env dev sets it up and deploys the job",
      );
      expect(mockPointSchedule).not.toHaveBeenCalled();
    });

    it('should skip a job without its schedule and deploy the others', async () => {
      mockPointSchedule
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await expect(
        awsDeployCronJobs(
          ctx,
          config,
          [job, { ...job, name: 'nightly-sync' }],
          { imageTag: 'abc', commandName: 'x', skipNotSetUp: true },
        ),
      ).resolves.toEqual({
        deployed: ['nightly-sync'],
        skipped: ['usage-report'],
      });
      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "usage-report: skipped, its schedule shop-auth-service-usage-report doesn't exist yet",
        ),
      );
    });

    it('should still fail on any other cron job failure', async () => {
      mockRegister.mockRejectedValueOnce(new Error('AccessDenied'));

      await expect(
        awsDeployCronJobs(ctx, config, [job], {
          imageTag: 'abc',
          commandName: 'x',
          skipNotSetUp: true,
        }),
      ).rejects.toMatchObject({ message: 'Failed to deploy 1 cron job(s)' });
    });
  });

  it('should refuse a job whose service is not NestJS, and go on with the others', async () => {
    await expect(
      awsDeployCronJobs(
        ctx,
        config,
        [{ ...job, name: 'a', targetService: 'frontend' }, job],
        { imageTag: 'abc', commandName: 'x' },
      ),
    ).rejects.toMatchObject({
      message: 'Failed to deploy 1 cron job(s)',
      hint: 'a: frontend is not a NestJS service in config.json',
    });
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it("should report a refused registration with AWS's reason", async () => {
    mockRegister.mockRejectedValueOnce(
      Object.assign(
        new Error('Failed to register a revision of shop-cron-usage-report'),
        {
          hint: 'AccessDenied',
        },
      ),
    );

    await expect(
      awsDeployCronJobs(ctx, config, [job], {
        imageTag: 'abc',
        commandName: 'x',
      }),
    ).rejects.toMatchObject({
      hint: 'usage-report: Failed to register a revision of shop-cron-usage-report: AccessDenied',
    });
  });
});
