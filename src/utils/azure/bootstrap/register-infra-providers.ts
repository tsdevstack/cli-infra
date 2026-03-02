/**
 * Register Azure resource providers required for infrastructure
 *
 * Idempotent — safe to call multiple times. Azure does not error if a provider
 * is already registered.
 */

import { ResourceManagementClient } from '@azure/arm-resources';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';

const REQUIRED_PROVIDERS = [
  'Microsoft.ContainerRegistry',
  'Microsoft.App',
  'Microsoft.Web',
  'Microsoft.DBforPostgreSQL',
  'Microsoft.Cache',
  'Microsoft.Cdn',
  'Microsoft.Network',
  'Microsoft.OperationalInsights',
  'Microsoft.ManagedIdentity',
  'Microsoft.Storage',
  'Microsoft.KeyVault',
] as const;

export interface RegisterProvidersResult {
  success: boolean;
  registered: string[];
  error?: string;
}

/**
 * Register all Azure resource providers needed for infrastructure deployment
 */
export async function registerInfraProviders(
  credentials: AzureCredentials,
): Promise<RegisterProvidersResult> {
  const registered: string[] = [];
  const runtime = buildRuntime();

  try {
    const credential = createAzureCredential(runtime, credentials);

    const resourceClient = new ResourceManagementClient(
      credential,
      credentials.subscriptionId,
    );

    for (const provider of REQUIRED_PROVIDERS) {
      await resourceClient.providers.register(provider);
      registered.push(provider);
    }

    return { success: true, registered };
  } catch (error: unknown) {
    return {
      success: false,
      registered,
      error:
        error instanceof Error
          ? error.message
          : 'Unknown error registering providers',
    };
  }
}
