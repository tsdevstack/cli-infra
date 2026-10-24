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
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';

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
  // Shared with cloud:init, which registers the same list early
  const { AZURE_REQUIRED_RESOURCE_PROVIDERS: REQUIRED_PROVIDERS } =
    getContext();
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
          'Register them once from an account with access to the subscription:',
          '  Azure Portal: Subscriptions → (your subscription) → Settings → Resource providers → select each one → Register',
          `  Azure CLI: az provider register --subscription ${credentials.subscriptionId} --namespace <name>`,
          'Or grant the Service Principal subscription-level Contributor.',
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
