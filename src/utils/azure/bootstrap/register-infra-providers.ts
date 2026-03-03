/**
 * Register Azure resource providers required for infrastructure
 *
 * Checks registration status first (read-only). Only attempts registration
 * for providers that are not yet registered. If all providers are already
 * registered, no subscription-level permissions are needed.
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
  'microsoft.insights',
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

    const unregistered: string[] = [];
    for (const provider of REQUIRED_PROVIDERS) {
      const info = await resourceClient.providers.get(provider);
      if (info.registrationState === 'Registered') {
        registered.push(provider);
      } else {
        unregistered.push(provider);
      }
    }

    if (unregistered.length === 0) {
      return { success: true, registered };
    }

    for (const provider of unregistered) {
      await resourceClient.providers.register(provider);
      registered.push(provider);
    }

    return { success: true, registered };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown error registering providers';

    if (message.includes('does not have authorization')) {
      const missing = REQUIRED_PROVIDERS.filter((p) => !registered.includes(p));
      return {
        success: false,
        registered,
        error: [
          'Insufficient permissions to register resource providers.',
          'Provider registration requires subscription-level Contributor role (not resource group).',
          `Unregistered providers: ${missing.join(', ')}`,
          '',
          'Grant the Service Principal subscription-level Contributor, or register',
          'providers from an account with subscription access before running this command.',
        ].join('\n'),
      };
    }

    return {
      success: false,
      registered,
      error: message,
    };
  }
}
