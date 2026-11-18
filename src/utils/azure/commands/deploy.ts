/**
 * Azure Deploy Handler
 *
 * Deploys complete Azure infrastructure:
 * 1. Base infrastructure (VNet, DB, Redis, IAM, ACR, Front Door)
 * 2. Services to Container Apps (if not --infra-only)
 * 3. Kong Gateway (if not --infra-only)
 */

import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import {
  executeTerraform,
  getTerraformOutput,
  getTerraformOutputJson,
} from '../terraform';
import { setSecretViaCli } from '../../credentials/set-secret-via-cli';
import { createStateBackend } from '../bootstrap/create-state-backend';
import { generateTerraformFiles } from './generate-terraform-files';
import { applyWithCapacityRetry } from '../../deploy/apply-with-capacity-retry';
import { findAzureApplyHint } from './find-azure-apply-hint';
import { buildFrontdoorRouteTargets } from './build-frontdoor-route-targets';
import {
  buildAzureResourceName,
  buildAzureTerraformEnv,
  checkTerraformInstalled,
  extractLockId,
  extractImportTargets,
  detectRouteAssociationError,
} from '@tsdevstack/infra-core';
import { checkPostgresAvailability } from '../preflight/check-postgres-availability';
import { loadInfrastructureConfig } from '../../infrastructure/load-infrastructure-config';
import { getDatabaseConfig } from '../../infrastructure/get-database-config';
import { infraDeployServices } from '../../../commands/infra-deploy-services';
import { infraKongGenerate } from '../../../commands/infra-kong-generate';
import { infraKongBuild } from '../../../commands/infra-kong-build';
import { infraKongDeploy } from '../../../commands/infra-kong-deploy';
import { lockDownPublicAccess } from './lock-down-public-access';
import { upgradeFrontdoorSku } from './upgrade-frontdoor-sku';
import { setSecretWithRetry } from '../set-secret-with-retry';
import { buildAzureDashboardUrl } from '../build-azure-dashboard-url';
import type { AzureCommandContext, DeployOptions } from './types';
import { resolveAzureNaming } from '../naming/resolve-azure-naming';
import { resolvePostgresServerName } from '../resolve-postgres-server-name';
import { putDatabaseLock } from '../database-lock/put-database-lock';
import { liftDatabaseLock } from '../database-lock/lift-database-lock';
import { setUpAzureDatabaseUsers } from '../set-up-azure-database-users';

/**
 * Deploy Azure infrastructure
 */
export async function azureDeploy(
  ctx: AzureCommandContext,
  options: DeployOptions,
): Promise<void> {
  const {
    logger,
    CliError,
    loadFrameworkConfig,
    ensureKeyVaultExists,
    AZURE_DB_JOBS_KEY_VAULT_SCOPE,
  } = getContext();
  const runtime = buildRuntime();

  checkTerraformInstalled(runtime);

  logger.info(`Project: ${ctx.projectName}`);
  logger.info(`Environment: ${ctx.targetEnv}`);
  logger.info(`Subscription: ${ctx.credentials.subscriptionId}`);
  logger.info(`Location: ${ctx.credentials.location}`);
  logger.newline();

  // Pre-flight: check PostgreSQL availability in target region
  // (and zone-redundant HA when database.ha is on)
  logger.info('Checking resource availability...');
  const infraConfig = loadInfrastructureConfig();
  const databaseConfig = getDatabaseConfig(infraConfig, ctx.targetEnv, 'azure');
  const pgCheck = await checkPostgresAvailability(ctx.credentials, {
    zoneRedundantHa: databaseConfig.ha,
  });
  if (!pgCheck.available) {
    throw new CliError(
      pgCheck.error || 'PostgreSQL is not available in this region',
      'infra:deploy',
    );
  }
  logger.newline();

  // Ensure state backend exists
  logger.info('Ensuring state backend exists...');

  const backendResult = await createStateBackend({
    projectName: ctx.projectName,
    env: ctx.targetEnv,
    credentials: ctx.credentials,
  });

  if (!backendResult.success) {
    throw new CliError(
      `Failed to create state backend: ${backendResult.error}`,
      'infra:deploy',
      'Check your Azure credentials and resource group permissions',
    );
  }
  logger.newline();

  // Generate all Terraform files
  // Names follow the scheme the environment was set up with
  const naming = await resolveAzureNaming(
    ctx.credentials,
    ctx.projectName,
    ctx.targetEnv,
  );
  const { outputDir, generateConfig } = generateTerraformFiles(
    ctx,
    'infra:deploy',
    { naming },
  );

  logger.complete('Configuration generated');
  logger.newline();

  // Each backend service's own Key Vault must exist before Terraform grants
  // its identity access: the CLI creates the vaults, Terraform does not
  const serviceVaults = Object.keys(generateConfig.serviceKeyVaults);
  if (serviceVaults.length > 0) {
    logger.info('Ensuring service Key Vaults exist...');
    for (const service of serviceVaults) {
      const vault = await ensureKeyVaultExists(
        ctx.projectName,
        ctx.targetEnv,
        ctx.credentials,
        service,
      );
      if (!vault.exists) {
        throw new CliError(
          `Failed to create the Key Vault for ${service}: ${vault.error}`,
          'infra:deploy',
          'Check that the deploy credentials can create Key Vaults in the resource group',
        );
      }
      if (vault.created) {
        logger.success(`  Created the Key Vault for ${service}`);
      }
    }
    logger.newline();
  }

  // The database jobs' vault (the server admin's password, each owner's
  // MIGRATION_DATABASE_URL): Terraform grants db-init access to it
  const dbJobsVault = await ensureKeyVaultExists(
    ctx.projectName,
    ctx.targetEnv,
    ctx.credentials,
    AZURE_DB_JOBS_KEY_VAULT_SCOPE,
  );
  if (!dbJobsVault.exists) {
    throw new CliError(
      `Failed to create the database jobs' Key Vault: ${dbJobsVault.error}`,
      'infra:deploy',
      'Check that the deploy credentials can create Key Vaults in the resource group',
    );
  }

  // Build Terraform environment
  const tfEnv = buildAzureTerraformEnv(runtime, ctx.credentials);

  // Initialize Terraform
  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: outputDir,
    env: tfEnv,
    reconfigure: true,
  });

  if (!initResult.success) {
    throw new CliError(
      'Initialization failed',
      'infra:deploy',
      initResult.error || 'Check the output above for details',
    );
  }

  // Upgrade Front Door SKU if needed (in-place, before apply)
  await upgradeFrontdoorSku({
    credentials: ctx.credentials,
    projectName: ctx.projectName,
    targetEnv: ctx.targetEnv,
    frontdoorPremium: generateConfig.frontdoorPremium,
  });

  // The database's delete lock (database.deletionProtection). The CLI keeps
  // it, not Terraform: it covers the server's databases too, so
  // infra:remove-service and infra:destroy lift it while they delete. Turned
  // off, it comes off before the apply, so this apply can delete a database.
  const lockTarget = {
    credentials: ctx.credentials,
    resourceGroupName: `${ctx.projectName}-${ctx.targetEnv}-rg`,
    serverName: resolvePostgresServerName(
      ctx.projectName,
      ctx.targetEnv,
      infraConfig,
      naming,
    ).name,
  };
  if (!databaseConfig.deletionProtection) {
    let lifted: boolean;
    try {
      lifted = await liftDatabaseLock(lockTarget);
    } catch (error) {
      throw new CliError(
        `Could not lift the delete lock on the database server ${lockTarget.serverName}: ${error instanceof Error ? error.message : String(error)}`,
        'infra:deploy',
        'Terraform has not applied anything. Locks need the User Access Administrator role on the resource group (Azure account setup, step 5).',
      );
    }
    if (lifted) {
      logger.info(
        `Delete lock lifted from the database server ${lockTarget.serverName} (database.deletionProtection is false)`,
      );
    }
  }

  // Apply infrastructure
  logger.newline();
  logger.info('Applying infrastructure...');
  logger.newline();

  let applyResult = await applyWithCapacityRetry(
    () =>
      executeTerraform('apply', {
        workDir: outputDir,
        autoApprove: true,
        env: tfEnv,
      }),
    'azure',
  );

  // If apply failed and --force-unlock is set, try to unlock and retry
  if (!applyResult.success && options.forceUnlock) {
    const lockId = extractLockId(applyResult.output);

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

      logger.success('State lock released, retrying apply...');
      logger.newline();

      applyResult = await executeTerraform('apply', {
        workDir: outputDir,
        autoApprove: true,
        env: tfEnv,
      });
    }
  }

  // Recovery: Two-phase deploy for custom domain route association errors
  // Azure Front Door host_name is ForceNew — can't delete a domain while a route references it.
  // Phase 1a: Targeted apply on routes + security policy ONLY (removes domain associations).
  // Phase 1b: Full apply (custom domains can now be deleted since nothing references them).
  // Phase 2:  Regenerate full config → apply (re-adds associations with new domains).
  //
  // Why targeted apply instead of -parallelism=1?
  // -parallelism=1 does NOT prevent concurrent execution of independent resources at the
  // same graph level — it's a known Terraform limitation (hashicorp/terraform#17924).
  // -target explicitly controls which resources Terraform processes in each apply.
  if (!applyResult.success && detectRouteAssociationError(applyResult.output)) {
    logger.newline();
    logger.warn('Custom domain route association conflict detected');
    logger.info(
      'Running three-step recovery: targeted route update → full apply → re-associate...',
    );
    logger.newline();

    // Phase 1a: Regenerate without custom domain associations, then targeted apply
    // on routes + security policy ONLY — these are the resources that reference custom domains.
    logger.info('Phase 1a: Updating routes and security policy (targeted)...');
    generateTerraformFiles(ctx, 'infra:deploy', {
      naming,
      skipCustomDomainAssociations: true,
    });

    const routeTargets = buildFrontdoorRouteTargets(generateConfig);

    const phase1aResult = await executeTerraform('apply', {
      workDir: outputDir,
      autoApprove: true,
      env: tfEnv,
      targets: routeTargets,
    });

    if (!phase1aResult.success) {
      throw new CliError(
        'Recovery failed at phase 1a (targeted route update)',
        'infra:deploy',
        phase1aResult.error || 'Check the output above for details',
      );
    }

    logger.newline();
    logger.success('Phase 1a complete: route associations removed');
    logger.newline();

    // Phase 1b: Full apply with skip config — custom domains can now be replaced
    // because no route or security policy references them anymore.
    logger.info('Phase 1b: Replacing custom domains (full apply)...');

    const phase1bResult = await executeTerraform('apply', {
      workDir: outputDir,
      autoApprove: true,
      env: tfEnv,
    });

    if (!phase1bResult.success) {
      throw new CliError(
        'Recovery failed at phase 1b (domain replacement)',
        'infra:deploy',
        phase1bResult.error || 'Check the output above for details',
      );
    }

    logger.newline();
    logger.success('Phase 1b complete: custom domains replaced');
    logger.newline();

    // Phase 2: Regenerate with full config (re-adds associations with new domains)
    logger.info('Phase 2: Re-associating routes with new domains...');
    generateTerraformFiles(ctx, 'infra:deploy', { naming });

    applyResult = await executeTerraform('apply', {
      workDir: outputDir,
      autoApprove: true,
      env: tfEnv,
    });
  }

  // Recovery: Auto-import for "already exists" errors (state drift)
  // Resources exist in Azure but are missing from Terraform state.
  if (!applyResult.success) {
    const importTargets = extractImportTargets(applyResult.output);

    if (importTargets.length > 0) {
      logger.newline();
      logger.warn(
        `Found ${importTargets.length} resource(s) to import into state`,
      );

      for (const target of importTargets) {
        logger.info(`Importing: ${target.address}`);
        const importResult = await executeTerraform('import', {
          workDir: outputDir,
          env: tfEnv,
          importAddress: target.address,
          importId: target.resourceId,
        });

        if (!importResult.success) {
          throw new CliError(
            `Failed to import resource: ${target.address}`,
            'infra:deploy',
            importResult.error || 'Check the output above for details',
          );
        }
      }

      logger.newline();
      logger.success('All resources imported, retrying apply...');
      logger.newline();

      applyResult = await executeTerraform('apply', {
        workDir: outputDir,
        autoApprove: true,
        env: tfEnv,
      });
    }
  }

  if (!applyResult.success) {
    throw new CliError(
      'Apply failed',
      'infra:deploy',
      findAzureApplyHint(applyResult.output) ||
        applyResult.error ||
        'Check the output above for details',
    );
  }

  logger.newline();
  logger.success('Infrastructure deployed successfully!');
  logger.newline();

  // The database's delete lock goes on after the apply: a first deploy
  // creates the server
  if (databaseConfig.deletionProtection) {
    try {
      await putDatabaseLock(lockTarget);
    } catch (error) {
      throw new CliError(
        `Could not put the delete lock on the database server ${lockTarget.serverName}: ${error instanceof Error ? error.message : String(error)}`,
        'infra:deploy',
        'Locks need the User Access Administrator role on the resource group (Azure account setup, step 5). The infrastructure itself is deployed: run infra:deploy again once the role is there.',
      );
    }
    logger.success(
      `Delete lock on the database server ${lockTarget.serverName}`,
    );
    logger.newline();
  }

  // ============================================
  // Approve Private Endpoint connections (Premium)
  // ============================================

  if (generateConfig.frontdoorPremium) {
    const resourceGroupName = getTerraformOutput(
      outputDir,
      'resource_group_name',
      tfEnv,
    );

    const appServiceNames = [
      'kong',
      ...Object.keys(generateConfig.frontends),
    ].map((app) =>
      buildAzureResourceName('appService', {
        projectName: ctx.projectName,
        environment: ctx.targetEnv,
        naming: naming.scheme,
        subscriptionId: naming.subscriptionId,
        app,
      }),
    );

    // Unified Private Link lifecycle: wait for PE → approve → wait for Approved → disable public access
    await lockDownPublicAccess({
      credentials: ctx.credentials,
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      appServiceNames,
      resourceGroupName,
    });

    logger.newline();
  }

  // ============================================
  // Sync infrastructure secrets to Key Vault
  // ============================================

  // Sync Redis secrets
  logger.info('Syncing Redis secrets to Key Vault...');

  try {
    const redisHost = getTerraformOutput(outputDir, 'redis_host', tfEnv);
    const redisPort = getTerraformOutput(outputDir, 'redis_port', tfEnv);
    const redisPassword = getTerraformOutput(
      outputDir,
      'redis_password',
      tfEnv,
    );

    setSecretViaCli('REDIS_HOST', redisHost, ctx.targetEnv);
    logger.success('  ✓ REDIS_HOST');

    setSecretViaCli('REDIS_PORT', redisPort, ctx.targetEnv);
    logger.success('  ✓ REDIS_PORT');

    setSecretViaCli('REDIS_PASSWORD', redisPassword, ctx.targetEnv);
    logger.success('  ✓ REDIS_PASSWORD');

    // Azure Managed Redis requires TLS
    setSecretViaCli('REDIS_TLS', 'true', ctx.targetEnv);
    logger.success('  ✓ REDIS_TLS');

    logger.newline();
    logger.complete('Redis secrets synced to Key Vault');
  } catch (error) {
    logger.newline();
    logger.warn('Failed to sync Redis secrets automatically');
    logger.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    logger.info('Run manually:');
    logger.info(
      `  npx tsdevstack cloud-secrets:set REDIS_HOST --value <host> --env ${ctx.targetEnv} --overwrite`,
    );
    logger.info(
      `  npx tsdevstack cloud-secrets:set REDIS_PORT --value <port> --env ${ctx.targetEnv} --overwrite`,
    );
    logger.info(
      `  npx tsdevstack cloud-secrets:set REDIS_PASSWORD --env ${ctx.targetEnv} --overwrite`,
    );
  }
  logger.newline();

  // Sync storage bucket secrets to Key Vault
  const frameworkConfig = loadFrameworkConfig();

  if (frameworkConfig.storage?.buckets?.length) {
    logger.info('Syncing storage bucket secrets to Key Vault...');

    try {
      const storageBuckets = getTerraformOutputJson<
        Record<string, { name: string }>
      >(outputDir, 'storage_buckets', tfEnv);

      for (const bucket of frameworkConfig.storage.buckets) {
        const secretKey = `STORAGE_BUCKET_${bucket.replace(/-/g, '_').toUpperCase()}`;
        const bucketName = storageBuckets[bucket].name;
        setSecretViaCli(secretKey, bucketName, ctx.targetEnv);
        logger.success(`  ✓ ${secretKey}`);
      }

      logger.newline();
      logger.complete('Storage bucket secrets synced to Key Vault');
    } catch (error) {
      logger.newline();
      logger.warn('Failed to sync storage bucket secrets automatically');
      logger.error(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      logger.info('Run manually:');
      logger.info(
        `  terraform -chdir="${outputDir}" output -json storage_buckets`,
      );
      logger.info('Then set each with:');
      logger.info(
        `  npx tsdevstack cloud-secrets:set STORAGE_BUCKET_<NAME> --value <bucket> --env ${ctx.targetEnv} --overwrite`,
      );
    }
    logger.newline();
  }

  // Database users: db-init (in the Container Apps environment) sets up each
  // service's owner and app role and writes both URLs
  const servicesWithDb = generateConfig.servicesWithDatabase.filter(
    (s) => s.hasDatabase,
  );
  if (servicesWithDb.length > 0) {
    await setUpAzureDatabaseUsers({
      terraformDir: outputDir,
      tfEnv,
      projectName: ctx.projectName,
      targetEnv: ctx.targetEnv,
      credentials: ctx.credentials,
      serviceNames: servicesWithDb.map((service) => service.name),
      dbJobsKeyVault: generateConfig.dbJobsKeyVault,
      serviceKeyVaults: generateConfig.databaseServiceKeyVaults,
    });
    logger.newline();
  }

  // Sync deterministic service URLs to Key Vault
  // Container Apps internal FQDN: https://{projectName}-{serviceName}.{cae-default-domain}
  logger.newline();
  logger.info('Syncing service URLs to Key Vault...');

  try {
    const caeDefaultDomain = getTerraformOutput(
      outputDir,
      'container_apps_env_default_domain',
      tfEnv,
    );

    for (const service of frameworkConfig.services) {
      if (!service.port) continue;
      const urlKey = `${service.name.replace(/-/g, '_').toUpperCase()}_URL`;
      const url = `https://${ctx.projectName}-${service.name}.${caeDefaultDomain}`;
      await setSecretWithRetry(urlKey, url, ctx.targetEnv);
      logger.success(`  ✓ ${urlKey} = ${url}`);
    }

    // KONG_INTERNAL_URL: Next.js server-side calls to Kong, at Kong's default
    // host name, which resolves to Kong's private endpoint in the VNet. Through
    // Front Door, its WAF would count every visitor as the Next.js app's
    // outbound address. Only projects with Next.js apps get the endpoint.
    if (Object.keys(generateConfig.frontends).length > 0) {
      const kongInternalUrl = getTerraformOutput(
        outputDir,
        'kong_internal_url',
        tfEnv,
      );
      await setSecretWithRetry(
        'KONG_INTERNAL_URL',
        kongInternalUrl,
        ctx.targetEnv,
      );
      logger.success(`  ✓ KONG_INTERNAL_URL = ${kongInternalUrl}`);
    }

    logger.newline();
    logger.complete('Service URLs synced to Key Vault');
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
    logger.info('Skipped: Service deployment, Kong Gateway');
    logger.info(
      'Run npx tsdevstack infra:deploy-services --env ' +
        ctx.targetEnv +
        ' to deploy services',
    );
    logger.newline();
    return;
  }

  // ============================================
  // Phase 2: Deploy Services to Container Apps
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info('Phase 2: Deploying Services to Container Apps...');
  logger.info('════════════════════════════════════════════');

  await infraDeployServices({ env: ctx.targetEnv, tag: options.tag });

  // ============================================
  // Phase 3: Deploy Kong Gateway
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.info('Phase 3: Deploying Kong Gateway...');
  logger.info('════════════════════════════════════════════');

  // Generate Kong config
  await infraKongGenerate({ env: ctx.targetEnv, nextSteps: false });

  // Build Kong image
  await infraKongBuild({
    env: ctx.targetEnv,
    tag: options.tag,
    nextSteps: false,
  });

  // Deploy Kong to Container Apps
  await infraKongDeploy({
    env: ctx.targetEnv,
    tag: options.tag,
    nextSteps: false,
  });

  // ============================================
  // Complete!
  // ============================================
  logger.newline();
  logger.info('════════════════════════════════════════════');
  logger.complete('Full infrastructure deployment complete!');
  logger.info('════════════════════════════════════════════');

  // The environment's dashboard (an Azure Monitor workbook)
  try {
    const workbookId = getTerraformOutput(outputDir, 'dashboard_id', tfEnv);
    logger.newline();
    logger.info(`Dashboard: ${buildAzureDashboardUrl(workbookId)}`);
  } catch {
    // No dashboard output (Terraform files from an older CLI)
  }

  // The DNS zone's name servers, last so they don't scroll away (if custom
  // domain configured)
  try {
    const nameServers = getTerraformOutputJson<string[]>(
      outputDir,
      'dns_name_servers',
      tfEnv,
    );
    if (nameServers && nameServers.length > 0) {
      logger.newline();
      logger.info('DNS Setup Required:');
      logger.newline();
      logger.info("  Point your domain registrar's nameservers to:");
      logger.newline();
      for (const ns of nameServers) {
        // Azure returns them with a trailing dot; registrars want none
        logger.info(`    ${ns.replace(/\.$/, '')}`);
      }
      logger.newline();
      logger.info(
        '  All other DNS records are managed by Terraform within Azure DNS.',
      );
      if (generateConfig.baseDomain) {
        logger.newline();
        logger.info(`  Verify: dig NS ${generateConfig.baseDomain} +short`);
      }
    }
  } catch {
    // No dns_name_servers output — no custom domain configured, skip silently
  }
  logger.newline();
}
