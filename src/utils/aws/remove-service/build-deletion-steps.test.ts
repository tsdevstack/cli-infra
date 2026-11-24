import { describe, it, expect, rs, beforeEach } from '@rstest/core';

rs.mock('../delete', () => {
  const ok = () => rs.fn().mockResolvedValue({ success: true, deleted: true });
  return {
    deleteEcsService: ok(),
    deleteS3Bucket: ok(),
    deleteSecretsByPrefix: ok(),
    deleteSharedSecretsForService: ok(),
    deleteCloudMapService: ok(),
    deleteCloudWatchLogGroup: ok(),
    deleteCloudFrontDistribution: ok(),
    deleteOriginAccessControl: ok(),
    deleteSchedulerSchedule: ok(),
    deleteEcsTaskDefinitionFamily: ok(),
  };
});

const { mockSend } = rs.hoisted(() => ({ mockSend: rs.fn() }));

rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: rs.fn().mockImplementation(() => ({ send: mockSend })),
  RunTaskCommand: rs.fn(),
  DescribeTasksCommand: rs.fn(),
}));

rs.mock('../terraform', () => ({
  getTerraformOutput: (_dir: string, name: string) =>
    name === 'private_subnet_ids' ? '["subnet-a","subnet-b"]' : 'sg-tasks',
}));

rs.mock('@tsdevstack/infra-core', () => ({
  buildAwsTerraformEnv: () => ({}),
}));

rs.mock('../../build-runtime', () => ({
  buildRuntime: () => ({}),
}));

rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: () => ({ region: 'eu-west-1' }),
}));

import { RunTaskCommand } from '@aws-sdk/client-ecs';
import { buildDeletionSteps } from './build-deletion-steps';
import {
  deleteCloudFrontDistribution,
  deleteCloudWatchLogGroup,
  deleteEcsTaskDefinitionFamily,
  deleteOriginAccessControl,
  deleteSchedulerSchedule,
} from '../delete';
import type { DiscoveredResources } from '../discovery';
import type { AWSCommandContext } from '../commands/types';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
  accountId: '123456789012',
};

const ctx = {
  projectName: 'myapp',
  projectRoot: '/project',
  targetEnv: 'dev',
  runningInCI: false,
  credentials,
} as unknown as AWSCommandContext;

function discovery(
  overrides: Partial<DiscoveredResources> = {},
): DiscoveredResources {
  return {
    ecsService: false,
    spaBucket: false,
    spaBucketName: 'myapp-admin-ui-spa-123456789012',
    cloudFrontDistributions: [],
    secrets: [],
    inferredType: 'unknown',
    ...overrides,
  };
}

function build(
  discovered: DiscoveredResources,
  hasDatabase = false,
  saveDatabase?: Parameters<typeof buildDeletionSteps>[0]['saveDatabase'],
): ReturnType<typeof buildDeletionSteps> {
  return buildDeletionSteps({
    ctx,
    serviceName: 'admin-ui',
    discovered,
    projectName: 'myapp',
    targetEnv: 'dev',
    coupledWorkers: [],
    hasDatabase,
    saveDatabase,
  });
}

describe('buildDeletionSteps (AWS)', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should delete an SPA's distribution, then its origin access control, then its bucket", async () => {
      const steps = build(
        discovery({
          spaBucket: true,
          cloudFrontDistributions: [{ id: 'E2SPA', kind: 'spa' }],
          spaOriginAccessControlId: 'OAC123',
        }),
      );
      const names = steps.map((step) => step.name);

      expect(names.indexOf('CloudFront distribution (SPA)')).toBeLessThan(
        names.indexOf('CloudFront origin access control'),
      );
      expect(names.indexOf('CloudFront origin access control')).toBeLessThan(
        names.indexOf('S3 bucket'),
      );

      await steps
        .find((step) => step.name === 'CloudFront distribution (SPA)')
        ?.execute();
      expect(deleteCloudFrontDistribution).toHaveBeenCalledWith({
        distributionId: 'E2SPA',
        credentials,
      });
      await steps
        .find((step) => step.name === 'CloudFront origin access control')
        ?.execute();
      expect(deleteOriginAccessControl).toHaveBeenCalledWith({
        originAccessControlId: 'OAC123',
        credentials,
      });
    });

    it("should delete a Next.js app's distribution", () => {
      const steps = build(
        discovery({
          ecsService: true,
          cloudFrontDistributions: [{ id: 'E2NEXT', kind: 'nextjs' }],
        }),
      );

      expect(
        steps.find((step) => step.name === 'CloudFront distribution (Next.js)')
          ?.resource,
      ).toBe('E2NEXT');
    });

    it("should delete the migration runs' log groups of a service with a database", async () => {
      const steps = build(discovery({ ecsService: true }), true).filter(
        (s) => s.name === 'Migration CloudWatch log group',
      );

      // Today's name, and the one without the project from earlier deploys
      expect(steps.map((step) => step.resource)).toEqual([
        '/ecs/myapp/migrate-admin-ui',
        '/ecs/migrate-admin-ui-migration',
      ]);
      for (const step of steps) await step.execute();
      expect(deleteCloudWatchLogGroup).toHaveBeenCalledWith({
        logGroupName: '/ecs/myapp/migrate-admin-ui',
        credentials,
      });
      expect(deleteCloudWatchLogGroup).toHaveBeenCalledWith({
        logGroupName: '/ecs/migrate-admin-ui-migration',
        credentials,
      });
    });
  });

  describe('Cron jobs', () => {
    it("should delete each cron job's schedule, task definition and log group before the workers and the service", async () => {
      const steps = buildDeletionSteps({
        ctx,
        serviceName: 'auth-service',
        discovered: discovery({ ecsService: true }),
        projectName: 'myapp',
        targetEnv: 'dev',
        coupledWorkers: ['auth-worker'],
        coupledCronJobs: [
          {
            name: 'usage-report',
            serviceName: 'auth-service',
            taskFamily: 'myapp-cron-usage-report',
            containerName: 'cron-usage-report',
            logGroupName: '/ecs/myapp/cron-usage-report',
            scheduleName: 'myapp-auth-service-usage-report',
          },
        ],
        hasDatabase: false,
      });

      expect(
        steps.slice(0, 5).map((step) => [step.name, step.resource]),
      ).toEqual([
        ['Cron job schedule', 'myapp-auth-service-usage-report'],
        ['Cron job', 'myapp-cron-usage-report'],
        ['Cron job log group', '/ecs/myapp/cron-usage-report'],
        ['Coupled worker', 'auth-worker'],
        ['ECS Service', 'auth-service'],
      ]);
      // Each line names the job: a service can have several
      expect(steps.slice(0, 3).map((step) => step.label)).toEqual([
        'Deleting the schedule of cron job usage-report',
        'Deleting the task definition of cron job usage-report',
        'Deleting the log group of cron job usage-report',
      ]);
      for (const step of steps.slice(0, 3)) await step.execute();
      expect(deleteSchedulerSchedule).toHaveBeenCalledWith({
        scheduleName: 'myapp-auth-service-usage-report',
        credentials,
      });
      expect(deleteEcsTaskDefinitionFamily).toHaveBeenCalledWith({
        family: 'myapp-cron-usage-report',
        credentials,
      });
      expect(deleteCloudWatchLogGroup).toHaveBeenCalledWith({
        logGroupName: '/ecs/myapp/cron-usage-report',
        credentials,
      });
    });
  });

  describe('saving the database', () => {
    it('should save it right before the drop, after the service is gone', async () => {
      const saveDatabase = rs.fn(async () => ({
        success: true,
        deleted: true,
      }));

      const steps = build(discovery({ ecsService: true }), true, saveDatabase);

      const names = steps.map((step) => step.name);
      const save = names.indexOf('Database save');
      expect(save).toBeGreaterThan(names.indexOf('ECS Service'));
      expect(names[save + 1]).toBe('RDS database');

      const step = steps[save];
      expect(step.label).toBe('Saving the database');
      expect(step.doneText).toBe('Saved');
      await step.execute();
      expect(saveDatabase).toHaveBeenCalledTimes(1);
    });

    it('should not save without a database or without a save (--skip-export)', () => {
      const withoutDatabase = build(discovery(), false, async () => ({
        success: true,
        deleted: true,
      }));
      const skipExport = build(discovery(), true);

      for (const steps of [withoutDatabase, skipExport]) {
        expect(steps.some((step) => step.name === 'Database save')).toBe(false);
      }
    });
  });

  describe('Edge cases', () => {
    it("should run db-delete in db-init's network (Terraform outputs), also after the ECS service is gone", async () => {
      mockSend
        .mockResolvedValueOnce({ tasks: [{ taskArn: 'arn:task' }] })
        .mockResolvedValueOnce({
          tasks: [{ lastStatus: 'STOPPED', containers: [{ exitCode: 0 }] }],
        });

      // No ECS service discovered (a rerun): no network configuration
      const steps = build(discovery(), true);
      const result = await steps
        .find((step) => step.name === 'RDS database')
        ?.execute();

      expect(result).toEqual({ success: true, deleted: true });
      expect(RunTaskCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          taskDefinition: 'myapp-db-delete',
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: ['subnet-a', 'subnet-b'],
              securityGroups: ['sg-tasks'],
              assignPublicIp: 'DISABLED',
            },
          },
        }),
      );
    });

    it('should add no CloudFront step for a service without distributions', () => {
      const names = build(discovery({ ecsService: true })).map((s) => s.name);

      expect(names.some((name) => name.startsWith('CloudFront'))).toBe(false);
    });

    it('should add no migration log group step without a database', () => {
      const names = build(discovery({ ecsService: true })).map((s) => s.name);

      expect(names).not.toContain('Migration CloudWatch log group');
    });
  });
});
