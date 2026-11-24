/**
 * Deploy cron jobs on AWS, one per entry: register the next revision of the
 * job's task definition (Terraform's family, cron-jobs.tf) with the
 * service's image, the service's DATABASE_URL when it has a database (as
 * the service gets it), and the job's name and timeout from
 * infrastructure.json, then point the job's EventBridge schedule at that
 * revision. With an image tag (deploy-services, right after the service)
 * the image is `{registry}/{service}:{tag}`; without one (deploy-schedulers)
 * it is the image the service's ECS service runs, and a service that was
 * never deployed stops the command with the hint services get.
 *
 * The task definition and the schedule come from Terraform (infra:deploy,
 * infra:deploy-schedulers); a job whose Terraform part is missing points
 * there. deploy-services skips such a job with a warning (skipNotSetUp): a
 * new cron job gets its Terraform part from infra:deploy-schedulers, which
 * then deploys it with the image the service runs. The scheduler role's
 * permissions come with the schedule.
 */

import path from 'node:path';
import { getContext } from '../../../context';
import {
  buildAwsTerraformEnv,
  CRON_JOB_NAME_ENV,
  CRON_JOB_TIMEOUT,
  CRON_JOB_TIMEOUT_ENV,
  registerEcsTaskDefinitionRevision,
  type CronJobConfig,
} from '@tsdevstack/infra-core';
import type { FrameworkConfig } from '@tsdevstack/cli/plugin';
import { buildRuntime } from '../../build-runtime';
import { getTerraformOutput } from '../terraform';
import { buildAwsCronJobNames } from '../build-aws-cron-job-names';
import { buildAwsDatabaseUrlSecretArn } from '../build-aws-database-url-secret-arn';
import { getDeployedEcsImage } from './get-deployed-ecs-image';
import { pointScheduleAtTaskDefinition } from './point-schedule-at-task-definition';
import type { AWSCommandContext } from './types';

export interface AwsDeployCronJobsOptions {
  /** The tag just deployed; left out, the image the service runs is used */
  imageTag?: string;
  /** The command, for the errors */
  commandName: string;
  /**
   * A job whose task definition or schedule doesn't exist yet is skipped
   * with a warning instead of failing the command (deploy-services)
   */
  skipNotSetUp?: boolean;
}

export interface AwsDeployCronJobsResult {
  /** The jobs deployed */
  deployed: string[];
  /** The jobs skipped: not set up yet (skipNotSetUp) */
  skipped: string[];
}

export async function awsDeployCronJobs(
  ctx: AWSCommandContext,
  config: FrameworkConfig,
  jobs: CronJobConfig[],
  options: AwsDeployCronJobsOptions,
): Promise<AwsDeployCronJobsResult> {
  const { logger, CliError } = getContext();
  const result: AwsDeployCronJobsResult = { deployed: [], skipped: [] };
  if (jobs.length === 0) return result;

  const { projectRoot, projectName, targetEnv, credentials } = ctx;
  const runtime = buildRuntime();
  const tfEnv = buildAwsTerraformEnv(runtime, credentials);
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );

  let ecrUrl: string;
  let clusterName: string;
  try {
    ecrUrl = getTerraformOutput(terraformDir, 'ecr_repository_url', tfEnv);
    clusterName = getTerraformOutput(terraformDir, 'ecs_cluster_name', tfEnv);
  } catch {
    throw new CliError(
      'Failed to get required Terraform outputs',
      options.commandName,
      `Run npx tsdevstack infra:deploy --env ${targetEnv} to deploy infrastructure`,
    );
  }

  logger.newline();
  logger.info(`Deploying ${jobs.length} cron job(s) to ECS...`);

  const failures: Array<{ job: string; error: string }> = [];
  const fail = (job: string, error: string, line: string): void => {
    failures.push({ job, error });
    logger.error(`  ${job}: ${line}`);
  };
  // A job whose Terraform part doesn't exist yet: skipped or failed
  const notSetUp = (job: string, missing: string): void => {
    const hint = `npx tsdevstack infra:deploy-schedulers --env ${targetEnv}`;
    if (options.skipNotSetUp) {
      result.skipped.push(job);
      logger.warn(
        `  ${job}: skipped, ${missing} doesn't exist yet. ${hint} sets it up and deploys the job`,
      );
      return;
    }
    fail(
      job,
      `${missing.charAt(0).toUpperCase()}${missing.slice(1)} doesn't exist yet: ${hint}`,
      `${missing} doesn't exist yet (run infra:deploy-schedulers)`,
    );
  };

  for (const job of jobs) {
    const service = config.services.find((s) => s.name === job.targetService);
    if (!service || service.type !== 'nestjs') {
      fail(
        job.name,
        `${job.targetService} is not a NestJS service in config.json`,
        `${job.targetService} is not a NestJS service`,
      );
      continue;
    }
    const names = buildAwsCronJobNames(projectName, service.name, job.name);

    try {
      const imageUri = options.imageTag
        ? `${ecrUrl}/${service.name}:${options.imageTag}`
        : await getDeployedEcsImage(credentials, clusterName, service.name);
      if (!imageUri) {
        fail(
          job.name,
          `${service.name} is not deployed yet: npx tsdevstack infra:deploy-services --env ${targetEnv} --service ${service.name}`,
          `${service.name} is not deployed yet, deploy the service first`,
        );
        continue;
      }

      const revision = await registerEcsTaskDefinitionRevision(runtime, {
        credentials,
        family: names.taskFamily,
        imageUri,
        environment: {
          [CRON_JOB_NAME_ENV]: job.name,
          [CRON_JOB_TIMEOUT_ENV]: String(
            job.timeout ?? CRON_JOB_TIMEOUT.aws.default,
          ),
        },
        // The service's DATABASE_URL, as its own task definition names it
        secrets: service.hasDatabase
          ? {
              DATABASE_URL: buildAwsDatabaseUrlSecretArn(
                credentials,
                projectName,
                service.name,
              ),
            }
          : undefined,
      });
      if (!revision) {
        notSetUp(job.name, `its task definition ${names.taskFamily}`);
        continue;
      }

      const pointed = await pointScheduleAtTaskDefinition({
        credentials,
        scheduleName: names.scheduleName,
        taskDefinitionArn: revision.taskDefinitionArn,
      });
      if (!pointed) {
        notSetUp(job.name, `its schedule ${names.scheduleName}`);
        continue;
      }

      result.deployed.push(job.name);
      logger.success(
        `  ${job.name} deployed (${revision.taskDefinitionArn.split('/').pop()}, ${job.schedule}, ${imageUri})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const reason = (error as { hint?: unknown } | null)?.hint;
      fail(
        job.name,
        typeof reason === 'string' ? `${message}: ${reason}` : message,
        message,
      );
    }
  }

  if (failures.length > 0) {
    throw new CliError(
      `Failed to deploy ${failures.length} cron job(s)`,
      options.commandName,
      failures.map((f) => `${f.job}: ${f.error}`).join('\n'),
    );
  }
  return result;
}
