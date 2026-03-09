/**
 * AWS Deploy Handler
 *
 * Deploys complete AWS infrastructure:
 * 1. State backend (S3 + DynamoDB)
 * 2. Base infrastructure (VPC, RDS, Redis, IAM, ECR, CloudFront)
 * 3. NestJS services to ECS (if not --infra-only)
 * 4. Next.js services to App Runner (if not --infra-only)
 * 5. Kong Gateway (if not --infra-only)
 * 6. SPA services to S3 (if not --infra-only)
 *
 * CloudFront is created in the initial Terraform run (step 2) when not using --infra-only.
 */

import path from 'node:path';
import fs from 'node:fs';
import inquirer from 'inquirer';
import { getContext } from '../../../context';
import { executeTerraform, getTerraformOutput } from '../terraform';
import {
  buildAwsTerraformEnv,
  checkTerraformInstalled,
  extractLockId,
} from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { setSecretViaCli } from '../../credentials/set-secret-via-cli';
import { generateTerraformFiles } from './generate-terraform-files';
import { deployEcsServices } from './deploy-ecs-services';
import { deployAppRunnerServices } from './deploy-apprunner-services';
import { awsKongDeploy } from './deploy-kong';
import { getGitSha } from '../../docker';
import { infraKongGenerate } from '../../../commands/infra-kong-generate';
import { infraKongBuild } from '../../../commands/infra-kong-build';
import { detectDeployedOrigins } from '../detect-deployed-origins';
import { deploySpaAws } from '../deploy/deploy-spa-aws';
import { buildAndPushDbInit } from './build-and-push-db-init';
import { buildAndPushDbDelete } from './build-and-push-db-delete';
import { runDbInit } from './run-db-init';
import type { AWSCommandContext, DeployOptions } from './types';

/**
 * Deploy AWS infrastructure
 */
export async function awsDeploy(
  ctx: AWSCommandContext,
  options: DeployOptions,
): Promise<void> {
  const { logger, CliError } = getContext();

  const runtime = buildRuntime();
  checkTerraformInstalled(runtime);

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`AWS Account: ${ctx.credentials.accountId}`);
  logger.info(`Region: ${ctx.credentials.region}`);
  logger.newline();

  // Ensure state backend exists (S3 + DynamoDB)
  logger.info('Ensuring state backend exists...');

  const backendResult = await createStateBackend({
    projectName: ctx.projectName,
    accountId: ctx.credentials.accountId,
    credentials: ctx.credentials,
  });

  if (!backendResult.success) {
    throw new CliError(
      `Failed to create state backend: ${backendResult.error}`,
      'infra:deploy',
      'Check your AWS credentials and permissions',
    );
  }

  if (backendResult.bucketCreated) {
    logger.success(`  ✓ Created S3 bucket: ${backendResult.bucketName}`);
  } else {
    logger.success(`  ✓ S3 bucket exists: ${backendResult.bucketName}`);
  }

  if (backendResult.tableCreated) {
    logger.success(`  ✓ Created DynamoDB table: ${backendResult.tableName}`);
  } else {
    logger.success(`  ✓ DynamoDB table exists: ${backendResult.tableName}`);
  }
  logger.newline();

  // Generate all Terraform files using shared function
  const { outputDir, servicesWithDatabase } = generateTerraformFiles(
    ctx,
    'infra:deploy',
  );

  logger.complete('Configuration generated');
  logger.newline();

  // Note: Database passwords are NOT passed to Terraform.
  // The db-init ECS task creates per-service databases/users and stores
  // DATABASE_URL directly in Secrets Manager after Terraform runs.

  // Detect deployed origins for conditional CloudFront creation
  // CloudFront is only created when App Runner services or SPA buckets exist
  const { loadFrameworkConfig } = getContext();
  const frameworkConfig = loadFrameworkConfig();

  const nextjsServices = frameworkConfig.services
    .filter((s) => s.type === 'nextjs')
    .map((s) => s.name);

  const spaServices = frameworkConfig.services
    .filter((s) => s.type === 'spa')
    .map((s) => s.name);

  if (nextjsServices.length > 0 || spaServices.length > 0) {
    logger.info('Detecting deployed origins for CloudFront...');
    const { nextjsOrigins, nextjsServiceArns, spaBucketsReady } =
      await detectDeployedOrigins({
        credentials: ctx.credentials,
        projectName: ctx.projectName,
        environment: ctx.targetEnv,
        nextjsServices,
        spaServices,
      });

    // For full deploy (not --infra-only), we know SPAs will be deployed,
    // so tell Terraform to create CloudFront unconditionally
    const spaBucketsForTerraform = options.infraOnly
      ? spaBucketsReady
      : Object.fromEntries(spaServices.map((name) => [name, true]));

    // Write detected origins to .auto.tfvars.json (Terraform auto-loads these)
    const detectedOriginsFile = path.join(
      outputDir,
      'detected-origins.auto.tfvars.json',
    );
    const originsVars = {
      nextjs_origins: nextjsOrigins,
      nextjs_service_arns: nextjsServiceArns,
      spa_buckets_ready: spaBucketsForTerraform,
    };
    fs.writeFileSync(detectedOriginsFile, JSON.stringify(originsVars, null, 2));

    const nextjsCount = Object.keys(nextjsOrigins).length;
    const spaCount = Object.values(spaBucketsReady).filter(Boolean).length;

    if (options.infraOnly) {
      if (nextjsCount > 0 || spaCount > 0) {
        logger.success(
          `  ✓ Found ${nextjsCount} App Runner origin(s), ${spaCount} SPA bucket(s) with content`,
        );
        logger.info('  CloudFront distributions will be created for these');
      } else {
        logger.info('  No deployed origins found - CloudFront will be skipped');
        logger.info('  Run infra:deploy again after deploying services');
      }
    } else {
      logger.info(
        `  ✓ Will create CloudFront for ${spaServices.length} SPA(s)`,
      );
      if (nextjsCount > 0) {
        logger.info(`  ✓ Found ${nextjsCount} App Runner origin(s)`);
      }
    }
    logger.newline();
  }

  // Build Terraform environment
  const tfEnv = buildAwsTerraformEnv(runtime, ctx.credentials);

  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: outputDir,
    env: tfEnv,
    reconfigure: true, // Handle backend changes (e.g., switching from GCP to AWS)
  });

  if (!initResult.success) {
    throw new CliError(
      'Initialization failed',
      'infra:deploy',
      initResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.info('Planning changes...');
  logger.newline();

  let planResult = await executeTerraform('plan', {
    workDir: outputDir,
    env: tfEnv,
  });

  // If plan failed and --force-unlock is set, try to unlock and retry
  if (!planResult.success && options.forceUnlock) {
    const lockId = extractLockId(planResult.output);

    if (lockId) {
      logger.newline();
      logger.warn('State lock detected, force unlocking...');
      logger.info(`Lock ID: ${lockId}`);
      logger.newline();

      const unlockResult = await executeTerraform('force-unlock', {
        workDir: outputDir,
        env: tfEnv,
        lockId,
      });

      if (!unlockResult.success) {
        throw new CliError(
          'Force unlock failed',
          'infra:deploy',
          unlockResult.error || 'Check the output above for details',
        );
      }

      logger.success('State lock released, retrying plan...');
      logger.newline();

      // Retry plan
      planResult = await executeTerraform('plan', {
        workDir: outputDir,
        env: tfEnv,
      });
    }
  }

  if (!planResult.success) {
    throw new CliError(
      'Planning failed',
      'infra:deploy',
      planResult.error || 'Check the output above for details',
    );
  }

  logger.newline();

  // Confirm
  if (!options.autoApprove && !ctx.runningInCI) {
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: 'Do you want to apply these changes?',
        default: false,
      },
    ]);

    if (!confirm) {
      logger.warn('Deployment cancelled by user');
      return;
    }
  }

  logger.newline();
  logger.info('Applying changes...');
  logger.newline();

  const applyResult = await executeTerraform('apply', {
    workDir: outputDir,
    autoApprove: true,
    env: tfEnv,
  });

  if (!applyResult.success) {
    throw new CliError(
      'Deployment failed',
      'infra:deploy',
      applyResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.success('Infrastructure deployed successfully!');
  logger.newline();

  // Sync Redis secrets to Secrets Manager
  logger.info('Syncing Redis secrets to Secrets Manager...');

  try {
    const redisHost = getTerraformOutput(outputDir, 'redis_host', tfEnv);
    const redisPort = getTerraformOutput(outputDir, 'redis_port', tfEnv);

    setSecretViaCli('REDIS_HOST', redisHost, ctx.targetEnv);
    logger.success('  ✓ REDIS_HOST');

    setSecretViaCli('REDIS_PORT', redisPort, ctx.targetEnv);
    logger.success('  ✓ REDIS_PORT');

    // Sync Redis auth token from Terraform to REDIS_PASSWORD secret
    const redisAuthToken = getTerraformOutput(
      outputDir,
      'redis_auth_token',
      tfEnv,
    );
    setSecretViaCli('REDIS_PASSWORD', redisAuthToken, ctx.targetEnv);
    logger.success('  ✓ REDIS_PASSWORD');

    // Set REDIS_TLS for AWS (required for ElastiCache transit encryption)
    setSecretViaCli('REDIS_TLS', 'true', ctx.targetEnv);
    logger.success('  ✓ REDIS_TLS');

    // Note: WAKEUP_LAMBDA_URL is set directly in ECS task definition env var

    // Sync ALB internal DNS for Kong upstream routing
    const albInternalDns = getTerraformOutput(
      outputDir,
      'alb_internal_dns',
      tfEnv,
    );
    setSecretViaCli('ALB_INTERNAL_DNS', albInternalDns, ctx.targetEnv);
    logger.success('  ✓ ALB_INTERNAL_DNS');

    logger.newline();
    logger.complete('Infrastructure secrets synced to Secrets Manager');
  } catch (error) {
    logger.newline();
    logger.warn('Failed to sync infrastructure secrets automatically');
    logger.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    logger.info('Run manually:');
    logger.info(`  terraform -chdir="${outputDir}" output -raw redis_host`);
    logger.info(`  terraform -chdir="${outputDir}" output -raw redis_port`);
    logger.info(
      `  terraform -chdir="${outputDir}" output -raw alb_internal_dns`,
    );
    logger.info('Then set each with:');
    logger.info(
      `  npx tsdevstack cloud-secrets:set <KEY> --value <value> --env ${ctx.targetEnv} --overwrite`,
    );
  }

  // ============================================
  // DB-Init: Create per-service databases and users
  // ============================================
  const servicesWithDb = servicesWithDatabase.filter((s) => s.hasDatabase);

  if (servicesWithDb.length > 0) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.info('DB-Init: Creating databases and users...');
    logger.info('════════════════════════════════════════════');

    // Build and push db-init image
    const dbInitDir = path.join(outputDir, 'db-init');
    const dbInitEcrUrl = getTerraformOutput(
      outputDir,
      'db_init_ecr_url',
      tfEnv,
    );

    await buildAndPushDbInit({
      dbInitDir,
      ecrUrl: dbInitEcrUrl,
      credentials: ctx.credentials,
      runtime,
    });

    // Run db-init task
    const clusterName = getTerraformOutput(
      outputDir,
      'ecs_cluster_name',
      tfEnv,
    );
    const dbInitTaskArn = getTerraformOutput(
      outputDir,
      'db_init_task_arn',
      tfEnv,
    );
    const privateSubnetIds = JSON.parse(
      getTerraformOutput(outputDir, 'private_subnet_ids', tfEnv),
    ) as string[];
    const ecsSecurityGroupId = getTerraformOutput(
      outputDir,
      'ecs_security_group_id',
      tfEnv,
    );

    await runDbInit({
      region: ctx.credentials.region,
      clusterName,
      taskDefinitionArn: dbInitTaskArn,
      subnetIds: privateSubnetIds,
      securityGroupId: ecsSecurityGroupId,
      credentials: ctx.credentials,
      services: servicesWithDatabase,
    });

    logger.newline();
    logger.complete('DB-Init complete - databases and users created');
  }

  // ============================================
  // DB-Delete: Build and push image for future service removal
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info('DB-Delete: Building image for service removal...');
  logger.info('════════════════════════════════════════════');

  const dbDeleteDir = path.join(outputDir, 'db-delete');
  const dbDeleteEcrUrl = getTerraformOutput(
    outputDir,
    'db_delete_ecr_url',
    tfEnv,
  );

  await buildAndPushDbDelete({
    dbDeleteDir,
    ecrUrl: dbDeleteEcrUrl,
    credentials: ctx.credentials,
    runtime,
  });

  logger.newline();
  logger.complete('DB-Delete image ready for service removal');

  // Sync deterministic service URLs to Secrets Manager
  // Cloud Map URLs are deterministic: http://{service}.{project}.local:8080
  logger.newline();
  logger.info('Syncing service URLs to Secrets Manager...');

  try {
    const config = loadFrameworkConfig();

    for (const service of config.services) {
      if (!service.port) continue;
      const urlKey = `${service.name.replace(/-/g, '_').toUpperCase()}_URL`;
      const url = `http://${service.name}.${ctx.projectName}.local:8080`;
      setSecretViaCli(urlKey, url, ctx.targetEnv);
      logger.success(`  ✓ ${urlKey} = ${url}`);
    }

    logger.newline();
    logger.complete('Service URLs synced to Secrets Manager');
  } catch (error) {
    logger.newline();
    logger.warn('Failed to sync service URLs automatically');
    logger.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Skip service deployment phases if --infra-only flag is set
  if (options.infraOnly) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.complete('Infrastructure provisioning complete!');
    logger.info('════════════════════════════════════════════');
    logger.newline();
    logger.info('Skipped: ECS service deployment, Kong Gateway');
    logger.info(
      'Run npx tsdevstack infra:deploy-services --env ' +
        ctx.targetEnv +
        ' to deploy services',
    );
    logger.newline();
    return;
  }

  // ============================================
  // Phase 2: Deploy NestJS Services to ECS
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info('Phase 2: Deploying NestJS Services to ECS...');
  logger.info('════════════════════════════════════════════');

  await deployEcsServices(ctx, { tag: options.tag });

  // ============================================
  // Phase 3: Deploy Next.js Services to App Runner
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info('Phase 3: Deploying Next.js Services to App Runner...');
  logger.info('════════════════════════════════════════════');

  await deployAppRunnerServices(ctx, { tag: options.tag });

  // ============================================
  // Phase 3b: Update CloudFront for Next.js (if App Runner was deployed)
  // ============================================
  if (nextjsServices.length > 0) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.info('Phase 3b: Creating CloudFront for Next.js...');
    logger.info('════════════════════════════════════════════');

    // Re-detect App Runner origins (now they exist)
    const {
      nextjsOrigins: newNextjsOrigins,
      nextjsServiceArns: newNextjsServiceArns,
    } = await detectDeployedOrigins({
      credentials: ctx.credentials,
      projectName: ctx.projectName,
      environment: ctx.targetEnv,
      nextjsServices,
      spaServices: [],
    });

    if (Object.keys(newNextjsOrigins).length > 0) {
      // Update detected origins file with App Runner URLs and ARNs (for WAF)
      const detectedOriginsFile = path.join(
        outputDir,
        'detected-origins.auto.tfvars.json',
      );
      const currentOrigins = JSON.parse(
        fs.readFileSync(detectedOriginsFile, 'utf-8'),
      );
      currentOrigins.nextjs_origins = newNextjsOrigins;
      currentOrigins.nextjs_service_arns = newNextjsServiceArns;
      fs.writeFileSync(
        detectedOriginsFile,
        JSON.stringify(currentOrigins, null, 2),
      );

      logger.info(
        `  Found ${Object.keys(newNextjsOrigins).length} App Runner origin(s)`,
      );
      logger.info('  Applying Terraform to create CloudFront...');
      logger.newline();

      const cfApplyResult = await executeTerraform('apply', {
        workDir: outputDir,
        autoApprove: true,
        env: tfEnv,
      });

      if (!cfApplyResult.success) {
        logger.warn(
          'CloudFront creation failed - services still accessible via App Runner URLs',
        );
      } else {
        logger.success('  ✓ CloudFront distributions created');
      }
    }
    logger.newline();
  }

  // ============================================
  // Phase 4: Deploy Kong Gateway
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info('Phase 4: Deploying Kong Gateway...');
  logger.info('════════════════════════════════════════════');

  // Generate Kong config
  await infraKongGenerate({ env: ctx.targetEnv });

  // Build Kong image (fetches secrets, builds, pushes to ECR)
  await infraKongBuild({ env: ctx.targetEnv, tag: options.tag });

  // Deploy Kong to ECS
  const imageTag = options.tag ?? getGitSha();
  await awsKongDeploy({
    projectRoot: ctx.projectRoot,
    targetEnv: ctx.targetEnv,
    credentials: ctx.credentials,
    imageTag,
  });

  // ============================================
  // Phase 5: Deploy SPA Services to S3
  // ============================================
  const spaServiceConfigs = frameworkConfig.services.filter(
    (s) => s.type === 'spa',
  );

  if (spaServiceConfigs.length > 0) {
    logger.newline();
    logger.info('════════════════════════════════════════════');
    logger.info('Phase 5: Deploying SPA Services to S3...');
    logger.info('════════════════════════════════════════════');

    for (const spaService of spaServiceConfigs) {
      await deploySpaAws({
        projectRoot: ctx.projectRoot,
        targetEnv: ctx.targetEnv,
        credentials: ctx.credentials,
        service: spaService,
      });
    }
  }

  // ============================================
  // Complete!
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.complete('Infrastructure deployment complete!');
  logger.info('════════════════════════════════════════════');
  logger.newline();
}
