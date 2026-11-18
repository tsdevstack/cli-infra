/**
 * Discover Deployed Services (Azure)
 *
 * Lists ALL deployed services in an environment by combining
 * Container Apps + App Services + SPA Storage Accounts.
 * Filters out infrastructure components (Container Apps Environment, etc.).
 */

import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { azure, buildAccountSuffix } from '@tsdevstack/infra-core';
import type {
  DeployedServiceInfo,
  DeployedServiceType,
  DiscoverDeployedServicesResult,
} from '../../discovery/types';
import { listContainerApps } from './list-container-apps';
import { listAppServices } from './list-app-services';
import { listSpaStorageAccounts } from './list-spa-storage-accounts';

export type { DeployedServiceInfo, DiscoverDeployedServicesResult };

/**
 * Discover all deployed services in an Azure environment
 *
 * @param options.spaServices - The project's SPAs (config.json): a storage
 *   account name is cut to 24 characters, so an SPA's name is found by
 *   building each one's account name. Without it (or for an SPA no longer
 *   in config) the name is read from the account's, possibly cut short.
 */
export async function discoverDeployedServices(options: {
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
  spaServices?: string[];
}): Promise<DiscoverDeployedServicesResult> {
  const { projectName, targetEnv, credentials, spaServices = [] } = options;

  const resourceGroupName = `${projectName}-${targetEnv}-rg`;

  // Query Container Apps, App Services, and SPA storage accounts in parallel
  const [appsResult, appServiceResult, spaResult] = await Promise.all([
    listContainerApps({
      credentials,
      resourceGroupName,
      projectName,
    }),
    listAppServices({
      credentials,
      resourceGroupName,
      projectName,
    }),
    listSpaStorageAccounts({
      credentials,
      resourceGroupName,
      projectName,
      targetEnv,
    }),
  ]);

  if (!appsResult.success) {
    return {
      success: false,
      services: [],
      error: appsResult.error,
    };
  }

  const services: DeployedServiceInfo[] = [];
  const prefix = `${projectName}-`;
  const envPrefix = `${projectName}-${targetEnv}-`;
  // Environments with unique names end App Service names with the
  // subscription's account suffix: tsdevstack-dev-kong-{suffix}
  const accountSuffix = `-${buildAccountSuffix(credentials.subscriptionId)}`;

  // Add Container Apps as services
  for (const app of appsResult.apps) {
    const serviceName = app.name.startsWith(prefix)
      ? app.name.slice(prefix.length)
      : app.name;

    let type: DeployedServiceType = 'backend';
    if (serviceName === 'kong') {
      type = 'kong';
    } else if (serviceName === 'frontend') {
      type = 'nextjs';
    } else if (serviceName.endsWith('-worker')) {
      type = 'worker';
    }

    services.push({
      name: serviceName,
      type,
      status: app.status,
      imageUri: app.image || 'unknown',
      resources: {
        containerApp: true,
        spaBucket: false,
        hasDatabase: false,
        secretCount: 0,
      },
    });
  }

  // Add App Services (kong, nextjs apps)
  if (appServiceResult.success) {
    for (const app of appServiceResult.apps) {
      // App Service names use env prefix: tsdevstack-dev-kong, tsdevstack-dev-frontend
      const unprefixed = app.name.startsWith(envPrefix)
        ? app.name.slice(envPrefix.length)
        : app.name.startsWith(prefix)
          ? app.name.slice(prefix.length)
          : app.name;
      const serviceName = unprefixed.endsWith(accountSuffix)
        ? unprefixed.slice(0, -accountSuffix.length)
        : unprefixed;

      // Skip if already discovered as Container App (shouldn't happen after migration)
      const existing = services.find((s) => s.name === serviceName);
      if (existing) {
        continue;
      }

      // App Service runs only Kong and the Next.js apps
      const type: DeployedServiceType =
        serviceName === 'kong' ? 'kong' : 'nextjs';

      services.push({
        name: serviceName,
        type,
        status: app.status,
        imageUri: app.image || 'unknown',
        resources: {
          containerApp: false,
          appService: true,
          spaBucket: false,
          hasDatabase: false,
          secretCount: 0,
        },
      });
    }
  }

  // Add SPAs (only if not already represented)
  if (spaResult.success) {
    for (const account of spaResult.accounts) {
      const spaName =
        spaServices.find(
          (name) =>
            azure.buildSpaStorageAccountName(
              projectName,
              targetEnv,
              name,
              credentials.subscriptionId,
            ) === account.name,
        ) ?? account.spaName;
      const existingService = services.find((s) => s.name === spaName);
      if (existingService) {
        existingService.resources.spaBucket = true;
      } else {
        services.push({
          name: spaName,
          type: 'spa',
          status: 'Active',
          imageUri: '-',
          resources: {
            containerApp: false,
            spaBucket: true,
            hasDatabase: false,
            secretCount: 0,
          },
        });
      }
    }
  }

  return { success: true, services };
}
