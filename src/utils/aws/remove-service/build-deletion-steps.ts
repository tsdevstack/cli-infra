/**
 * Build Deletion Steps (AWS)
 *
 * Build deletion steps based on discovered resources.
 *
 * Order is critical:
 * 1. ECS Service / App Runner (stop traffic)
 * 2. Cloud Map service instance
 * 3. S3 bucket (SPA only)
 * 4. CloudFront invalidation
 * 5. Database (via db-delete ECS task)
 * 6. Terraform state sync (uses pre-fetched DB passwords)
 * 7. Service-scoped secrets
 * 8. Shared secrets cleanup
 * 9. CloudWatch log group
 */

import type { DeletionStep } from './types';
import type { AWSCommandContext } from '../commands/types';
import type { DiscoveredResources } from '../discovery';
import {
  deleteEcsService,
  deleteS3Bucket,
  deleteSecretsByPrefix,
  deleteSharedSecretsForService,
  deleteCloudMapService,
  deleteCloudWatchLogGroup,
} from '../delete';
import { syncTerraformState } from './sync-terraform-state';
import {
  ECSClient,
  RunTaskCommand,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import { buildAWSClientConfig } from '../build-aws-client-config';

export interface BuildDeletionStepsOptions {
  ctx: AWSCommandContext;
  serviceName: string;
  discovered: DiscoveredResources;
  projectName: string;
  targetEnv: string;
  dbPasswords: Record<string, string>;
  coupledWorkers: string[];
  hasDatabase: boolean;
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
    dbPasswords,
    coupledWorkers,
    hasDatabase,
  } = options;
  const { credentials } = ctx;
  const clusterName = `${projectName}-cluster`;
  const steps: DeletionStep[] = [];

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

  // 1. Delete ECS service or App Runner (stops traffic)
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

  // 3. Delete S3 bucket (includes files)
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

  // 4. Invalidate CloudFront cache (for SPA)
  if (discovered.spaBucket) {
    // TODO: Get distribution ID from discovery
    // For now, skip this step as it requires knowing the distribution ID
  }

  // 5. Delete database (via db-delete ECS task)
  if (hasDatabase) {
    steps.push({
      name: 'RDS database',
      resource: serviceName,
      execute: async () => {
        const clientConfig = buildAWSClientConfig(credentials);
        const ecs = new ECSClient(clientConfig);

        try {
          // Run db-delete task
          const runTaskResponse = await ecs.send(
            new RunTaskCommand({
              cluster: clusterName,
              taskDefinition: `${projectName}-db-delete`,
              launchType: 'FARGATE',
              networkConfiguration: {
                awsvpcConfiguration: {
                  subnets: discovered.networkConfiguration?.subnets ?? [],
                  securityGroups:
                    discovered.networkConfiguration?.securityGroups ?? [],
                  assignPublicIp: discovered.networkConfiguration
                    ?.assignPublicIp
                    ? 'ENABLED'
                    : 'DISABLED',
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

  // 6. Sync Terraform state (uses pre-fetched passwords)
  steps.push({
    name: 'Terraform state sync',
    resource: 'infrastructure state',
    execute: async () => {
      try {
        await syncTerraformState(ctx, dbPasswords);
        return { success: true, deleted: true };
      } catch (error) {
        return {
          success: true,
          deleted: false,
          error: `Warning: ${error instanceof Error ? error.message : 'Unknown'}`,
        };
      }
    },
  });

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
