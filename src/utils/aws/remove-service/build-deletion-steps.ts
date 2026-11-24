/**
 * Build Deletion Steps (AWS)
 *
 * Build deletion steps based on discovered resources.
 *
 * Order is critical:
 * 0. The service's cron jobs (schedule, task definition, log group), then
 *    its workers
 * 1. ECS Service (stop traffic)
 * 2. Cloud Map service instance
 * 3. The service's CloudFront distributions (disable, wait, delete), then
 *    the SPA's origin access control
 * 4. S3 bucket (SPA only)
 * 5. Database save (db-init export), then the database (db-delete ECS task)
 * 6. Service-scoped secrets
 * 7. Shared secrets cleanup
 * 8. CloudWatch log group
 *
 * Terraform's state is left as it is: every later plan, deploy or destroy
 * refreshes it first.
 */

import type { DeletionStep, DeletionStepResult } from './types';
import type { AWSCommandContext } from '../commands/types';
import type { AwsCronJobInfo, DiscoveredResources } from '../discovery';
import {
  deleteEcsService,
  deleteS3Bucket,
  deleteSecretsByPrefix,
  deleteSharedSecretsForService,
  deleteCloudMapService,
  deleteCloudWatchLogGroup,
  deleteCloudFrontDistribution,
  deleteOriginAccessControl,
  deleteSchedulerSchedule,
  deleteEcsTaskDefinitionFamily,
} from '../delete';
import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import { buildAWSClientConfig } from '../build-aws-client-config';
import { buildAwsMigrationNames } from '../build-aws-migration-names';
import path from 'node:path';
import { buildAwsTerraformEnv } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';

export interface BuildDeletionStepsOptions {
  ctx: AWSCommandContext;
  serviceName: string;
  discovered: DiscoveredResources;
  projectName: string;
  targetEnv: string;
  coupledWorkers: string[];
  /** The service's cron jobs (found by their task definitions' tags) */
  coupledCronJobs?: AwsCronJobInfo[];
  hasDatabase: boolean;
  /**
   * Saves the database before it is dropped (left out: no saved database,
   * --skip-export, or nothing to save)
   */
  saveDatabase?: () => Promise<DeletionStepResult>;
}

/**
 * Build deletion steps based on discovered resources
 */
export function buildDeletionSteps(
  options: BuildDeletionStepsOptions,
): DeletionStep[] {
  const {
    ctx,
    serviceName,
    discovered,
    projectName,
    targetEnv: _targetEnv, // unused on AWS (kept for cross-provider interface parity)
    coupledWorkers,
    coupledCronJobs = [],
    hasDatabase,
    saveDatabase,
  } = options;
  const { credentials } = ctx;
  const clusterName = `${projectName}-cluster`;
  const steps: DeletionStep[] = [];

  // 0. The service's cron jobs: the schedule first (nothing starts a task
  // any more), then the task definition (it runs with the service's role),
  // then its log group
  for (const cronJob of coupledCronJobs) {
    steps.push({
      name: 'Cron job schedule',
      label: `Deleting the schedule of cron job ${cronJob.name}`,
      resource: cronJob.scheduleName,
      execute: () =>
        deleteSchedulerSchedule({
          scheduleName: cronJob.scheduleName,
          credentials,
        }),
    });
    steps.push({
      name: 'Cron job',
      label: `Deleting the task definition of cron job ${cronJob.name}`,
      resource: cronJob.taskFamily,
      execute: () =>
        deleteEcsTaskDefinitionFamily({
          family: cronJob.taskFamily,
          credentials,
        }),
    });
    steps.push({
      name: 'Cron job log group',
      label: `Deleting the log group of cron job ${cronJob.name}`,
      resource: cronJob.logGroupName,
      execute: () =>
        deleteCloudWatchLogGroup({
          logGroupName: cronJob.logGroupName,
          credentials,
        }),
    });
  }

  // 0. Delete coupled workers first
  for (const workerName of coupledWorkers) {
    steps.push({
      name: 'Coupled worker',
      resource: workerName,
      execute: () =>
        deleteEcsService({
          credentials,
          clusterName,
          serviceName: workerName,
        }),
    });
  }

  // 1. Delete ECS service (stops traffic)
  if (discovered.ecsService) {
    steps.push({
      name: 'ECS Service',
      resource: serviceName,
      execute: () =>
        deleteEcsService({
          credentials,
          clusterName,
          serviceName,
        }),
    });
  }

  // 2. Delete Cloud Map service instance
  steps.push({
    name: 'Cloud Map service',
    resource: serviceName,
    execute: () =>
      deleteCloudMapService({
        projectName,
        serviceName,
        credentials,
      }),
  });

  // 3. The service's own CloudFront distributions. CloudFront deletes only a
  // disabled distribution whose change has deployed: several minutes each.
  // The API distribution is shared, caches nothing (CachingDisabled) and stays.
  for (const distribution of discovered.cloudFrontDistributions) {
    steps.push({
      name:
        distribution.kind === 'spa'
          ? 'CloudFront distribution (SPA)'
          : 'CloudFront distribution (Next.js)',
      resource: distribution.id,
      execute: () =>
        deleteCloudFrontDistribution({
          distributionId: distribution.id,
          credentials,
        }),
    });
  }

  // The SPA's origin access control (refused while a distribution uses it)
  if (discovered.spaOriginAccessControlId) {
    const originAccessControlId = discovered.spaOriginAccessControlId;
    steps.push({
      name: 'CloudFront origin access control',
      resource: originAccessControlId,
      execute: () =>
        deleteOriginAccessControl({ originAccessControlId, credentials }),
    });
  }

  // 4. Delete S3 bucket (includes files)
  if (discovered.spaBucket) {
    steps.push({
      name: 'S3 bucket',
      resource: discovered.spaBucketName,
      execute: () =>
        deleteS3Bucket({
          bucketName: discovered.spaBucketName,
          credentials,
        }),
    });
  }

  // 5. Save the database, right before the drop: the service and its
  // workers are gone, so nothing writes in between. A failed save stops
  // here, with the database untouched.
  if (hasDatabase && saveDatabase) {
    steps.push({
      name: 'Database save',
      label: 'Saving the database',
      doneText: 'Saved',
      skippedText: 'Not saved: removing without its data',
      resource: serviceName,
      execute: saveDatabase,
    });
  }

  // 5a. Delete database (via db-delete ECS task)
  if (hasDatabase) {
    steps.push({
      name: 'RDS database',
      resource: serviceName,
      execute: async () => {
        const clientConfig = buildAWSClientConfig(credentials);
        const ecs = new ECSClient(clientConfig);

        try {
          // The network db-init runs in (Terraform outputs), not the ECS
          // service's: a rerun after a failed step finds the service deleted
          const terraformDir = path.join(
            ctx.projectRoot,
            'infrastructure',
            'terraform',
            ctx.targetEnv,
          );
          const tfEnv = buildAwsTerraformEnv(buildRuntime(), credentials);
          const subnets = JSON.parse(
            getTerraformOutput(terraformDir, 'private_subnet_ids', tfEnv),
          ) as string[];
          const securityGroup = getTerraformOutput(
            terraformDir,
            'ecs_security_group_id',
            tfEnv,
          );

          // Run db-delete task
          const runTaskResponse = await ecs.send(
            new RunTaskCommand({
              cluster: clusterName,
              taskDefinition: `${projectName}-db-delete`,
              launchType: 'FARGATE',
              networkConfiguration: {
                awsvpcConfiguration: {
                  subnets,
                  securityGroups: [securityGroup],
                  assignPublicIp: 'DISABLED',
                },
              },
              overrides: {
                containerOverrides: [
                  {
                    name: 'db-delete',
                    environment: [
                      {
                        name: 'SERVICES',
                        value: JSON.stringify([serviceName]),
                      },
                    ],
                  },
                ],
              },
            }),
          );

          const taskArn = runTaskResponse.tasks?.[0]?.taskArn;
          if (!taskArn) {
            return {
              success: false,
              deleted: false,
              error: 'Failed to start task',
            };
          }

          // Wait for task to complete
          let attempts = 0;
          while (attempts < 60) {
            const describeResponse = await ecs.send(
              new DescribeTasksCommand({
                cluster: clusterName,
                tasks: [taskArn],
              }),
            );

            const task = describeResponse.tasks?.[0];
            if (task?.lastStatus === 'STOPPED') {
              if (task.containers?.[0]?.exitCode === 0) {
                return { success: true, deleted: true };
              } else {
                return {
                  success: false,
                  deleted: false,
                  error: 'Task exited with non-zero code',
                };
              }
            }

            await new Promise((resolve) => setTimeout(resolve, 5000));
            attempts++;
          }

          return { success: false, deleted: false, error: 'Task timeout' };
        } catch (error) {
          return {
            success: false,
            deleted: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
    });
  }

  // 7. Delete service-scoped secrets ({project}-{service}-*)
  if (discovered.secrets.length > 0) {
    steps.push({
      name: 'Service-scoped secrets',
      resource: `${discovered.secrets.length} secrets`,
      execute: () =>
        deleteSecretsByPrefix({
          prefix: `${projectName}-${serviceName}-`,
          credentials,
        }).then((result) => ({
          success: result.success,
          deleted: result.totalDeleted > 0,
          error: result.error,
        })),
    });
  }

  // 8. Delete shared secrets for this service
  steps.push({
    name: 'Shared secrets for service',
    resource: 'DB passwords, API key, service URL',
    execute: () =>
      deleteSharedSecretsForService({
        projectName,
        serviceName,
        hasDatabase,
        credentials,
      }).then((result) => ({
        success: result.success,
        deleted: result.deleted.length > 0,
        error: result.error,
      })),
  });

  // 9. Delete CloudWatch log groups (service + workers)
  steps.push({
    name: 'CloudWatch log group',
    resource: `/ecs/${projectName}/${serviceName}`,
    execute: () =>
      deleteCloudWatchLogGroup({
        logGroupName: `/ecs/${projectName}/${serviceName}`,
        credentials,
      }),
  });

  // The migration runs' log group (created by the CLI, not Terraform)
  if (hasDatabase) {
    // Today's name and the one without the project, from earlier deploys
    const { logGroupName, legacyLogGroupName } = buildAwsMigrationNames(
      projectName,
      serviceName,
    );
    for (const migrationLogGroup of [logGroupName, legacyLogGroupName]) {
      steps.push({
        name: 'Migration CloudWatch log group',
        resource: migrationLogGroup,
        execute: () =>
          deleteCloudWatchLogGroup({
            logGroupName: migrationLogGroup,
            credentials,
          }),
      });
    }
  }

  // Delete log groups for coupled workers
  for (const workerName of coupledWorkers) {
    steps.push({
      name: 'Worker CloudWatch log group',
      resource: `/ecs/${projectName}/${workerName}`,
      execute: () =>
        deleteCloudWatchLogGroup({
          logGroupName: `/ecs/${projectName}/${workerName}`,
          credentials,
        }),
    });
  }

  return steps;
}
