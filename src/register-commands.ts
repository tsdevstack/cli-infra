/**
 * Register Infrastructure Plugin Commands
 *
 * Registers all infrastructure-related commands with Commander.js.
 * Called by cli-core after context initialization.
 */

import type { Command } from 'commander';
import { getContext, wrapCommand } from './context';
import { loadInfrastructureConfig } from './utils/infrastructure/load-infrastructure-config';
import { validateInfrastructureConfig } from './utils/infrastructure/validate-infrastructure-config';
import { INFRASTRUCTURE_CONFIG_FILENAME } from './constants';
import { infraBootstrap } from './commands/infra-bootstrap';
import { infraInit } from './commands/infra-init';
import { infraGenerate } from './commands/infra-generate';
import { infraDeploy } from './commands/infra-deploy';
import { infraPlan } from './commands/infra-plan';
import { infraDestroy } from './commands/infra-destroy';
import { infraDockerGenerate } from './commands/infra-docker-generate';
import { infraDockerBuild } from './commands/infra-docker-build';
import { infraDockerPush } from './commands/infra-docker-push';
import { infraDbMigratePlan } from './commands/infra-db-migrate-plan';
import { infraDbMigrateRun } from './commands/infra-db-migrate-run';
import { infraDeployServices } from './commands/infra-deploy-services';
import { infraDeploySingleService } from './commands/infra-deploy-single-service';
import { infraKongGenerate } from './commands/infra-kong-generate';
import { infraKongBuild } from './commands/infra-kong-build';
import { infraKongDeploy } from './commands/infra-kong-deploy';
import { infraLbDeploy } from './commands/infra-lb-deploy';
import { infraRemoveService } from './commands/infra-remove-service';
import { infraRemoveDetachedWorker } from './commands/infra-remove-detached-worker';
import { infraServiceStatus } from './commands/infra-service-status';
import { infraListDeployed } from './commands/infra-list-deployed';
import { infraDeployScheduler } from './commands/infra-deploy-scheduler';
import { infraDeploySchedulers } from './commands/infra-deploy-schedulers';
import { infraListSchedulers } from './commands/infra-list-schedulers';
import { infraRemoveScheduler } from './commands/infra-remove-scheduler';
import { ciInit } from './commands/ci-init';
import { ciGenerate } from './commands/ci-generate';

/**
 * Register all infrastructure commands with the CLI program
 */
export function registerInfraPlugin(program: Command): void {
  // infra:bootstrap - Enable APIs and add roles to SA (run once per project)
  program
    .command('infra:bootstrap')
    .description('Bootstrap GCP project (enable APIs, add roles to SA)')
    .option('--env <environment>', 'Target environment')
    .action(
      wrapCommand(async (options: { env?: string }) => {
        await infraBootstrap(options);
      }),
    );

  // infra:init - Initialize infrastructure (create Terraform state bucket)
  program
    .command('infra:init')
    .description('Initialize infrastructure (creates Terraform state bucket)')
    .option(
      '--env <environment>',
      'Target environment (defaults to first available)',
    )
    .action(
      wrapCommand(async (options: { env?: string }) => {
        await infraInit(options);
      }),
    );

  // infra:status - Check infrastructure configuration status
  program
    .command('infra:status')
    .description('Check infrastructure configuration status')
    .action(
      wrapCommand(async () => {
        const { logger } = getContext();

        logger.newline();
        logger.info('Infrastructure Plugin Status');
        logger.newline();

        // Try to load and validate infrastructure.json
        const config = loadInfrastructureConfig();

        if (!config) {
          logger.info(`ℹ No ${INFRASTRUCTURE_CONFIG_FILENAME} found`);
          logger.info('  Using built-in defaults for all services');
        } else {
          validateInfrastructureConfig(config);
          logger.success(
            `✓ ${INFRASTRUCTURE_CONFIG_FILENAME} valid (version ${config.version})`,
          );

          // Count environments and services
          const environments = Object.keys(config).filter(
            (k) => k !== 'version' && k !== '$schema',
          );
          logger.info(
            `  Environments with overrides: ${environments.join(', ') || 'none'}`,
          );
        }

        logger.newline();
      }),
    );

  // infra:generate - Generate Terraform files
  program
    .command('infra:generate')
    .description('Generate Terraform files to infrastructure/terraform/{env}/')
    .option('--env <environment>', 'Target environment')
    .action(
      wrapCommand(async (options: { env?: string }) => {
        await infraGenerate(options);
      }),
    );

  // infra:plan - Show planned infrastructure changes
  program
    .command('infra:plan')
    .description('Show planned infrastructure changes (terraform plan)')
    .option('--env <environment>', 'Target environment')
    .option('--force-unlock', 'Force unlock a stuck state lock before planning')
    .action(
      wrapCommand(async (options: { env?: string; forceUnlock?: boolean }) => {
        await infraPlan(options);
      }),
    );

  // infra:deploy - Full infrastructure deployment
  program
    .command('infra:deploy')
    .description(
      'Deploy full infrastructure: base + services + Kong + LB (if DOMAIN set)',
    )
    .option('--env <environment>', 'Target environment')
    .option('--auto-approve', 'Skip confirmation prompt')
    .option(
      '--infra-only',
      'Only provision infrastructure, skip service deployment',
    )
    .option('--tag <tag>', 'Image tag to deploy (defaults to current git SHA)')
    .option(
      '--force-unlock',
      'Force unlock a stuck state lock before deploying',
    )
    .action(
      wrapCommand(
        async (options: {
          env?: string;
          autoApprove?: boolean;
          infraOnly?: boolean;
          tag?: string;
          forceUnlock?: boolean;
        }) => {
          await infraDeploy(options);
        },
      ),
    );

  // infra:destroy - Destroy infrastructure
  program
    .command('infra:destroy')
    .description('Destroy infrastructure (terraform destroy)')
    .option('--env <environment>', 'Target environment')
    .option('--auto-approve', 'Skip confirmation prompt')
    .action(
      wrapCommand(async (options: { env?: string; autoApprove?: boolean }) => {
        await infraDestroy(options);
      }),
    );

  // infra:generate-docker - Generate Dockerfiles for services
  program
    .command('infra:generate-docker')
    .description('Generate Dockerfiles for deployable services')
    .option('--service <name>', 'Generate for specific service only')
    .action(
      wrapCommand(async (options: { service?: string }) => {
        await infraDockerGenerate(options);
      }),
    );

  // infra:build-docker - Build Docker images
  program
    .command('infra:build-docker')
    .description(
      'Build Docker images with BuildKit registry caching (parallel by default)',
    )
    .option('--service <name>', 'Build specific service only')
    .option('--env <environment>', 'Target environment')
    .option('--tag <tag>', 'Image tag (defaults to git SHA)')
    .option('--no-parallel', 'Build sequentially (for debugging)')
    .option('--max-parallel <n>', 'Maximum concurrent builds (default: 2)', '2')
    .action(
      wrapCommand(
        async (options: {
          service?: string;
          env?: string;
          tag?: string;
          parallel?: boolean;
          maxParallel?: string;
        }) => {
          await infraDockerBuild({
            ...options,
            maxParallel: options.maxParallel
              ? parseInt(options.maxParallel, 10)
              : undefined,
          });
        },
      ),
    );

  // infra:push-docker - Push Docker images to Artifact Registry
  program
    .command('infra:push-docker')
    .description(
      'Push Docker images to Artifact Registry (parallel by default)',
    )
    .option('--service <name>', 'Push specific service only')
    .option('--env <environment>', 'Target environment')
    .option('--tag <tag>', 'Image tag (defaults to git SHA)')
    .option('--no-parallel', 'Push sequentially (for debugging)')
    .action(
      wrapCommand(
        async (options: {
          service?: string;
          env?: string;
          tag?: string;
          parallel?: boolean;
        }) => {
          await infraDockerPush(options);
        },
      ),
    );

  // infra:plan-db-migrate - Show pending database migrations
  program
    .command('infra:plan-db-migrate')
    .description('Show pending database migrations for a service')
    .requiredOption('--service <name>', 'Service with database to check')
    .option('--env <environment>', 'Target environment')
    .action(
      wrapCommand(async (options: { service: string; env?: string }) => {
        await infraDbMigratePlan(options);
      }),
    );

  // infra:run-db-migrate - Apply database migrations
  program
    .command('infra:run-db-migrate')
    .description('Apply pending database migrations for a service')
    .requiredOption('--service <name>', 'Service with database to migrate')
    .option('--env <environment>', 'Target environment')
    .action(
      wrapCommand(async (options: { service: string; env?: string }) => {
        await infraDbMigrateRun(options);
      }),
    );

  // infra:deploy-service - Full chain deploy for ONE service (build, push, migrate, deploy)
  program
    .command('infra:deploy-service [service-name]')
    .description('Build, push, and deploy a single service (full workflow)')
    .option('--env <environment>', 'Target environment')
    .option('--skip-generate', 'Skip Dockerfile generation step')
    .option('--tag <tag>', 'Image tag to deploy (defaults to current git SHA)')
    .action(
      wrapCommand(
        async (
          serviceName: string | undefined,
          options: { env?: string; skipGenerate?: boolean; tag?: string },
        ) => {
          await infraDeploySingleService(serviceName, options);
        },
      ),
    );

  // infra:deploy-services - Orchestrate full service deployment workflow
  program
    .command('infra:deploy-services')
    .description(
      'Build, push, and deploy services (orchestrates full workflow, parallel)',
    )
    .option('--service <names>', 'Deploy specific service(s) (comma-separated)')
    .option('--env <environment>', 'Target environment')
    .option('--skip-generate', 'Skip Dockerfile generation step')
    .option('--tag <tag>', 'Image tag to deploy (defaults to current git SHA)')
    .option(
      '--max-parallel <n>',
      'Maximum concurrent operations (default: 2)',
      '2',
    )
    .action(
      wrapCommand(
        async (options: {
          service?: string;
          env?: string;
          skipGenerate?: boolean;
          tag?: string;
          maxParallel?: string;
        }) => {
          await infraDeployServices({
            ...options,
            maxParallel: options.maxParallel
              ? parseInt(options.maxParallel, 10)
              : undefined,
          });
        },
      ),
    );

  // infra:generate-kong - Generate Kong configuration for cloud deployment
  program
    .command('infra:generate-kong')
    .description('Generate Kong declarative config from OpenAPI specs')
    .option('--env <environment>', 'Target environment')
    .action(
      wrapCommand(async (options: { env?: string }) => {
        await infraKongGenerate(options);
      }),
    );

  // infra:build-kong - Build Kong Docker image with baked-in config
  program
    .command('infra:build-kong')
    .description('Build Kong Docker image with resolved config baked in')
    .option('--env <environment>', 'Target environment')
    .option('--tag <tag>', 'Image tag (defaults to git SHA)')
    .action(
      wrapCommand(async (options: { env?: string; tag?: string }) => {
        await infraKongBuild(options);
      }),
    );

  // infra:deploy-kong - Deploy Kong Gateway to Cloud Run (+ LB if DOMAIN set)
  program
    .command('infra:deploy-kong')
    .description(
      'Deploy Kong Gateway to Cloud Run (deploys LB if DOMAIN secret is set)',
    )
    .option('--env <environment>', 'Target environment')
    .option('--tag <tag>', 'Image tag (defaults to git SHA)')
    .option('--skip-lb', 'Skip load balancer deployment even if DOMAIN is set')
    .action(
      wrapCommand(
        async (options: { env?: string; tag?: string; skipLb?: boolean }) => {
          await infraKongDeploy(options);
        },
      ),
    );

  // infra:deploy-lb - Deploy External HTTP(S) Load Balancer
  program
    .command('infra:deploy-lb')
    .description(
      'Deploy External HTTP(S) Load Balancer for Kong Gateway (reads DOMAIN from secrets)',
    )
    .option('--env <environment>', 'Target environment')
    .option('--auto-approve', 'Skip confirmation prompt')
    .action(
      wrapCommand(async (options: { env?: string; autoApprove?: boolean }) => {
        await infraLbDeploy(options);
      }),
    );

  // infra:remove-service - Remove a service from cloud (one environment at a time)
  program
    .command('infra:remove-service [service-name]')
    .description(
      'Remove a service from cloud (deletes Cloud Run, secrets, database, etc.)',
    )
    .option('--env <environment>', 'Target environment')
    .option('--confirm', 'Skip confirmation prompts (required in CI)')
    .option('--dry-run', 'Show what would be deleted without deleting')
    .action(
      wrapCommand(
        async (
          serviceName: string | undefined,
          options: { env?: string; confirm?: boolean; dryRun?: boolean },
        ) => {
          await infraRemoveService(serviceName, options);
        },
      ),
    );

  // infra:remove-detached-worker - Remove an orphaned worker from Cloud Run
  program
    .command('infra:remove-detached-worker')
    .description(
      'Remove an orphaned worker from Cloud Run (workers not in config.json)',
    )
    .option('--env <environment>', 'Target environment')
    .option('--worker <name>', 'Worker name to remove')
    .option('--confirm', 'Skip confirmation prompts (required in CI)')
    .action(
      wrapCommand(
        async (options: {
          env?: string;
          worker?: string;
          confirm?: boolean;
        }) => {
          await infraRemoveDetachedWorker(options);
        },
      ),
    );

  // infra:service-status - Check cloud resource status for a service
  program
    .command('infra:service-status [service-name]')
    .description('Check cloud resource status for a specific service')
    .option('--env <environment>', 'Target environment')
    .action(
      wrapCommand(
        async (serviceName: string | undefined, options: { env?: string }) => {
          await infraServiceStatus(serviceName, options);
        },
      ),
    );

  // infra:list-deployed - List all deployed services
  program
    .command('infra:list-deployed')
    .description('List all deployed services in an environment')
    .option('--env <environment>', 'Target environment')
    .action(
      wrapCommand(async (options: { env?: string }) => {
        await infraListDeployed(options);
      }),
    );

  // infra:deploy-scheduler - Deploy a single scheduled job
  program
    .command('infra:deploy-scheduler')
    .description('Deploy a single scheduled job to Cloud Scheduler')
    .option('--env <environment>', 'Target environment')
    .option('--job <name>', 'Scheduled job name to deploy')
    .option('--auto-approve', 'Skip confirmation prompt')
    .action(
      wrapCommand(
        async (options: {
          env?: string;
          job?: string;
          autoApprove?: boolean;
        }) => {
          await infraDeployScheduler(options);
        },
      ),
    );

  // infra:deploy-schedulers - Deploy all scheduled jobs
  program
    .command('infra:deploy-schedulers')
    .description('Deploy all scheduled jobs to Cloud Scheduler')
    .option('--env <environment>', 'Target environment')
    .option('--auto-approve', 'Skip confirmation prompt')
    .action(
      wrapCommand(async (options: { env?: string; autoApprove?: boolean }) => {
        await infraDeploySchedulers(options);
      }),
    );

  // infra:list-schedulers - List scheduled jobs and status
  program
    .command('infra:list-schedulers')
    .description('List scheduled jobs and their deployment status')
    .option('--env <environment>', 'Target environment')
    .action(
      wrapCommand(async (options: { env?: string }) => {
        await infraListSchedulers(options);
      }),
    );

  // infra:remove-scheduler - Remove a scheduled job from Cloud Scheduler
  program
    .command('infra:remove-scheduler')
    .description('Remove a scheduled job from Cloud Scheduler')
    .option('--env <environment>', 'Target environment')
    .option('--job <name>', 'Job name to remove')
    .option('--confirm', 'Skip confirmation prompts (required in CI)')
    .action(
      wrapCommand(
        async (options: { env?: string; job?: string; confirm?: boolean }) => {
          await infraRemoveScheduler(options);
        },
      ),
    );

  // infra:init-ci - Initialize CI/CD with GitHub Actions
  program
    .command('infra:init-ci')
    .description('Initialize CI/CD (generates GitHub Actions workflows)')
    .option('--github', 'Use GitHub Actions (required)')
    .option(
      '--framework',
      'Also generate framework development workflows (monorepo only)',
    )
    .action(
      wrapCommand(
        async (options: { github?: boolean; framework?: boolean }) => {
          await ciInit(options);
        },
      ),
    );

  // infra:generate-ci - Regenerate CI workflows
  program
    .command('infra:generate-ci')
    .description('Regenerate CI workflows from ci.json')
    .option('-e, --env <env>', 'Target environment')
    .option(
      '--framework',
      'Also generate framework development workflows (monorepo only)',
    )
    .action(
      wrapCommand(async (options: { env?: string; framework?: boolean }) => {
        await ciGenerate(options);
      }),
    );
}
