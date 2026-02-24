/**
 * Discover Deployed Services (Azure)
 *
 * Lists ALL deployed services in an environment by combining
 * Container Apps + App Services + SPA Storage Accounts.
 * Filters out infrastructure components (Container Apps Environment, etc.).
 */

import type { AzureCredentials } from '@tsdevstack/cli/plugin';
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
 */
export async function discoverDeployedServices(options: {
  projectName: string;
  targetEnv: string;
  credentials: AzureCredentials;
}): Promise<DiscoverDeployedServicesResult> {
  const { projectName, targetEnv, credentials } = options;

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
      const serviceName = app.name.startsWith(envPrefix)
        ? app.name.slice(envPrefix.length)
        : app.name.startsWith(prefix)
          ? app.name.slice(prefix.length)
          : app.name;

      // Skip if already discovered as Container App (shouldn't happen after migration)
      const existing = services.find((s) => s.name === serviceName);
      if (existing) {
        continue;
      }

      let type: DeployedServiceType = 'backend';
      if (serviceName === 'kong') {
        type = 'kong';
      } else if (
        serviceName.includes('frontend') ||
        serviceName.includes('nextjs')
      ) {
        type = 'nextjs';
      }

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
      const existingService = services.find((s) => s.name === account.spaName);
      if (existingService) {
        existingService.resources.spaBucket = true;
      } else {
        services.push({
          name: account.spaName,
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
