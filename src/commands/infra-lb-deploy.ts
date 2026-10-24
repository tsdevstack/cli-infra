/**
 * infra:deploy-lb Command
 *
 * Deploy External HTTP(S) Load Balancer with host-based routing.
 * Routes traffic based on hostname:
 * - api.{DOMAIN} -> Kong Gateway
 * - Frontend domains from infrastructure.json -> respective Cloud Run services
 *
 * Generates Terraform for:
 * - Static IP reservation
 * - Serverless NEGs for Kong and frontends
 * - URL map with host-based routing
 * - SSL certificate (Google-managed) for all domains
 * - HTTPS proxy and forwarding rules
 * - HTTP to HTTPS redirect
 */

import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import inquirer from 'inquirer';
import { getContext } from '../context';
import { setupGCPInfraCommand } from '../utils/gcp/setup/setup-gcp-infra-command';
import { buildGcpTerraformEnv, gcp } from '@tsdevstack/infra-core';
import {
  executeTerraform,
  getTerraformOutput,
  getTerraformOutputJson,
  toDnsAuthName,
} from '../utils/gcp/terraform';
import { buildRuntime } from '../utils/build-runtime';
import { toTfVarSuffix, toTerraformId } from '../utils/terraform';
import { padRight } from '../utils/display/pad-right';
import { logAaaaRecords } from '../utils/gcp/display/log-aaaa-records';
import { fetchDbPasswordsFromSecretManager } from '../utils/credentials/fetch-db-passwords-from-secret-manager';
import { loadInfrastructureConfig } from '../utils/infrastructure/load-infrastructure-config';
import { validateInfrastructureConfig } from '../utils/infrastructure/validate-infrastructure-config';
import { getFrontendServicesWithDomains } from '../utils/infrastructure/get-frontend-services-with-domains';
import type {
  EnvironmentOverrides,
  SecurityOverride,
  LoadBalancerOverride,
  AccessControlOverride,
} from '../utils/infrastructure/types';

interface InfraLbDeployOptions {
  env?: string;
  autoApprove?: boolean;
}

/**
 * Deploy External HTTP(S) Load Balancer with host-based routing
 */
export async function infraLbDeploy(
  options: InfraLbDeployOptions,
): Promise<void> {
  const { logger, CliError, loadFrameworkConfig } = getContext();

  // Guard: LB deploy is GCP-only (AWS/Azure handle LB in infra:deploy via Terraform)
  const frameworkConfig = loadFrameworkConfig();
  const provider = frameworkConfig.cloud.provider;
  if (provider && provider !== 'gcp') {
    throw new CliError(
      'infra:deploy-lb is only available for GCP',
      'infra:deploy-lb',
      'AWS and Azure manage load balancing through infra:deploy (Terraform)',
    );
  }

  logger.newline();
  logger.info('Deploying External HTTP(S) Load Balancer...');
  logger.newline();

  // Set up command context
  const ctx = await setupGCPInfraCommand(options, 'infra:deploy-lb');
  const { projectRoot, targetEnv, credentials } = ctx;

  // Get DOMAIN from Secret Manager (base domain, e.g., createdevstack.io)
  // API will be at api.{DOMAIN}
  logger.info('Reading DOMAIN secret...');
  let baseDomain: string;
  try {
    baseDomain = execSync(
      `npx tsdevstack cloud-secrets:get DOMAIN --env ${targetEnv}`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim();
  } catch {
    throw new CliError(
      'DOMAIN secret not found',
      'infra:deploy-lb',
      `Set it first: npx tsdevstack cloud-secrets:set DOMAIN example.com --env ${targetEnv}`,
    );
  }

  if (!baseDomain) {
    throw new CliError(
      'DOMAIN secret is empty',
      'infra:deploy-lb',
      `Set it first: npx tsdevstack cloud-secrets:set DOMAIN example.com --env ${targetEnv}`,
    );
  }

  let apiDomain = `api.${baseDomain}`;

  // Load infrastructure.json to get frontend domains and security config
  const infraConfig = loadInfrastructureConfig();
  if (infraConfig) {
    validateInfrastructureConfig(infraConfig);
  }
  const envOverrides = infraConfig?.[targetEnv] as
    EnvironmentOverrides | undefined;
  const frontendServices = getFrontendServicesWithDomains(
    envOverrides,
    frameworkConfig.services,
  );
  const securityConfig = envOverrides?.security as SecurityOverride | undefined;
  const customWafRules = securityConfig?.waf?.customRules;
  const loadBalancerConfig = envOverrides?.loadBalancer as
    LoadBalancerOverride | undefined;
  const redirectDomains = loadBalancerConfig?.redirectDomains;
  const accessControl = envOverrides?.accessControl as
    AccessControlOverride | undefined;
  // Canonical domain is the first frontend domain, or baseDomain if no frontends
  const canonicalDomain =
    frontendServices.length > 0 ? frontendServices[0].domain : baseDomain;
  // Override apiDomain from config if set
  if (loadBalancerConfig?.apiDomain) {
    apiDomain = loadBalancerConfig.apiDomain;
  }

  // Log configuration
  logger.info(`Environment: ${targetEnv}`);
  logger.info(`Base Domain: ${baseDomain}`);
  logger.info(`API Domain: ${apiDomain}`);

  if (frontendServices.length > 0) {
    logger.info('Frontend Services:');
    for (const service of frontendServices) {
      const typeLabel = service.type === 'spa' ? '(SPA/CDN)' : '(Cloud Run)';
      logger.info(`  - ${service.name}: ${service.domain} ${typeLabel}`);
    }
  } else {
    logger.info('Frontend Services: None configured (API-only deployment)');
  }

  if (redirectDomains && redirectDomains.length > 0) {
    logger.info(
      `Redirect Domains: ${redirectDomains.join(', ')} -> ${canonicalDomain}`,
    );
  }
  logger.newline();

  // Validate terraform directory exists (infrastructure must be deployed first)
  const terraformDir = path.join(
    projectRoot,
    'infrastructure',
    'terraform',
    targetEnv,
  );
  if (!fs.existsSync(terraformDir)) {
    throw new CliError(
      `Terraform directory not found: ${terraformDir}`,
      'infra:deploy-lb',
      `Run npx tsdevstack infra:deploy --env ${targetEnv} first`,
    );
  }

  // Generate load balancer terraform
  logger.generating('Generating load balancer configuration...');

  const lbTf = gcp.generateLoadBalancerTf({
    apiDomain,
    frontendServices,
    customWafRules,
    redirectDomains,
    canonicalDomain,
    noIndex: accessControl?.noIndex,
  });
  fs.writeFileSync(path.join(terraformDir, 'loadbalancer.tf'), lbTf);

  logger.complete('Load balancer configuration generated');
  logger.newline();

  // Build Terraform environment
  const runtime = buildRuntime();
  const tfEnv = buildGcpTerraformEnv(runtime, credentials);

  // Load database passwords (required for terraform plan/apply)
  const servicesWithDb = frameworkConfig.services
    .filter((s) => s.hasDatabase)
    .map((s) => ({ name: s.name, hasDatabase: true }));

  if (servicesWithDb.length > 0) {
    logger.info('Loading database passwords...');

    // Always fetch from Secret Manager (works in both local and CI with WIF)
    const dbPasswords = await fetchDbPasswordsFromSecretManager(
      targetEnv,
      servicesWithDb,
    );

    // Add database passwords as TF_VAR_db_{suffix}_password
    for (const [serviceName, password] of Object.entries(dbPasswords)) {
      const suffix = toTfVarSuffix(serviceName);
      tfEnv[`TF_VAR_db_${suffix}_password`] = password;
    }
    logger.success('  Loaded from Secret Manager');
    logger.newline();
  }

  // Initialize terraform (in case new providers needed)
  logger.info('Initializing...');
  logger.newline();

  const initResult = await executeTerraform('init', {
    workDir: terraformDir,
    env: tfEnv,
    reconfigure: true,
  });

  if (!initResult.success) {
    throw new CliError(
      'Initialization failed',
      'infra:deploy-lb',
      initResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.info('Planning changes...');
  logger.newline();

  const planResult = await executeTerraform('plan', {
    workDir: terraformDir,
    env: tfEnv,
  });

  if (!planResult.success) {
    throw new CliError(
      'Planning failed',
      'infra:deploy-lb',
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
      logger.warn('Setup cancelled by user');
      return;
    }
  }

  logger.newline();
  logger.info('Applying changes...');
  logger.newline();

  const applyResult = await executeTerraform('apply', {
    workDir: terraformDir,
    autoApprove: true,
    env: tfEnv,
  });

  if (!applyResult.success) {
    throw new CliError(
      'Apply failed',
      'infra:deploy-lb',
      applyResult.error || 'Check the output above for details',
    );
  }

  logger.newline();
  logger.success('Load balancer deployed successfully!');
  logger.newline();

  // Display DNS configuration
  try {
    const lbIp = getTerraformOutput(terraformDir, 'load_balancer_ip', tfEnv);
    logger.info(`Load Balancer IP: ${lbIp}`);
    logger.newline();
    logger.info('DNS Configuration Required:');
    logger.newline();

    // A Records table
    const aRecords: Array<{ host: string; value: string }> = [
      { host: apiDomain, value: lbIp },
    ];
    for (const service of frontendServices) {
      aRecords.push({ host: service.domain, value: lbIp });
    }

    logger.info('  A Records (point to load balancer IP):');
    logger.newline();
    const aHostWidth = Math.max(...aRecords.map((r) => r.host.length));
    logger.info(`    ${padRight('Host', aHostWidth)}  Value`);
    logger.info(`    ${'─'.repeat(aHostWidth + 2 + lbIp.length)}`);
    for (const record of aRecords) {
      logger.info(`    ${padRight(record.host, aHostWidth)}  ${record.value}`);
    }

    // AAAA records for IPv6 visitors (state from before the IPv6 address
    // has no such output: skip)
    try {
      logAaaaRecords(
        [
          ...aRecords.map((record) => record.host),
          ...(redirectDomains ?? []).flatMap((d) => [d, `*.${d}`]),
        ],
        getTerraformOutput(terraformDir, 'load_balancer_ipv6', tfEnv),
      );
    } catch {
      // No IPv6 address yet
    }

    // SSL Certificate Validation CNAME records
    interface DnsAuthRecord {
      name: string;
      type: string;
      data: string;
    }

    const cnameRecords: Array<{ host: string; value: string }> = [];

    try {
      const apiAuth = getTerraformOutputJson<DnsAuthRecord>(
        terraformDir,
        'dns_auth_api_record',
        tfEnv,
      );
      cnameRecords.push({ host: apiAuth.name, value: apiAuth.data });

      for (const service of frontendServices) {
        const tfId = toTerraformId(service.name);
        const serviceAuth = getTerraformOutputJson<DnsAuthRecord>(
          terraformDir,
          `dns_auth_${tfId}_record`,
          tfEnv,
        );
        cnameRecords.push({
          host: serviceAuth.name,
          value: serviceAuth.data,
        });
      }

      if (redirectDomains && redirectDomains.length > 0) {
        for (const domain of redirectDomains) {
          const redirectTfId = toTerraformId(toDnsAuthName(domain));
          const redirectAuth = getTerraformOutputJson<DnsAuthRecord>(
            terraformDir,
            `dns_auth_redirect_${redirectTfId}_record`,
            tfEnv,
          );
          cnameRecords.push({
            host: redirectAuth.name,
            value: redirectAuth.data,
          });
        }
      }
    } catch {
      // SSL validation records may not exist on first deploy
    }

    if (cnameRecords.length > 0) {
      logger.newline();
      logger.info('  SSL Certificate Validation (CNAME records):');
      logger.newline();
      const cnameHostWidth = Math.max(
        ...cnameRecords.map((r) => r.host.length),
      );
      const cnameValueWidth = Math.max(
        ...cnameRecords.map((r) => r.value.length),
      );
      logger.info(`    ${padRight('Host', cnameHostWidth)}  Value`);
      logger.info(`    ${'─'.repeat(cnameHostWidth + 2 + cnameValueWidth)}`);
      for (const record of cnameRecords) {
        logger.info(
          `    ${padRight(record.host, cnameHostWidth)}  ${record.value}`,
        );
      }
    }

    // Redirect domains
    if (redirectDomains && redirectDomains.length > 0) {
      logger.newline();
      logger.info('  Redirect Domains (A records):');
      logger.newline();
      const redirectHostWidth = Math.max(
        ...redirectDomains.map((d) => d.length),
        ...redirectDomains.map((d) => `*.${d}`.length),
      );
      logger.info(`    ${padRight('Host', redirectHostWidth)}  Value`);
      logger.info(`    ${'─'.repeat(redirectHostWidth + 2 + lbIp.length)}`);
      for (const domain of redirectDomains) {
        logger.info(`    ${padRight(domain, redirectHostWidth)}  ${lbIp}`);
        logger.info(
          `    ${padRight(`*.${domain}`, redirectHostWidth)}  ${lbIp}`,
        );
      }
    }

    logger.newline();
    logger.info('Next steps:');
    logger.info('  1. Add A + CNAME records at your domain registrar');
    logger.info(
      '  2. Wait for SSL certificate provisioning (up to 60 minutes)',
    );
    logger.info(`  3. Verify: dig A ${baseDomain} +short`);
    logger.info(`  4. Test: curl https://${apiDomain}/auth/v1/health`);
  } catch {
    logger.warn('Could not retrieve load balancer IP from terraform output');
  }

  logger.newline();
}
