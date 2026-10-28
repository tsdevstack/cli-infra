/**
 * Wait until App Service has resolved an app's Key Vault references
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { WebSiteManagementClient } from '@azure/arm-appservice';
import { createAzureCredential } from '@tsdevstack/infra-core';
import type { AzureCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { buildRuntime } from '../../build-runtime';
import {
  AZURE_KEY_VAULT_REFERENCE_FATAL_STATUSES,
  AZURE_KEY_VAULT_REFERENCE_WAIT,
} from '../../../constants';

/**
 * App Service resolves Key Vault references when the app starts; an
 * unresolved one leaves the app with the reference text instead of the
 * secret. A role assignment made just before can take minutes to apply, so
 * while a reference is denied the app is restarted and checked again, until
 * every reference resolves or the time runs out.
 *
 * @param options.credentials - Azure credentials of the environment
 * @param options.resourceGroupName - Resource group of the app
 * @param options.appServiceName - App Service name
 * @param options.settingNames - App settings that hold Key Vault references
 * @param options.timeoutMs - Longest wait (default: 10 minutes)
 * @param options.intervalMs - Time between checks (default: 20 seconds)
 * @throws CliError when a reference cannot resolve, or does not in time
 */
export async function waitForKeyVaultReferences(options: {
  credentials: AzureCredentials;
  resourceGroupName: string;
  appServiceName: string;
  settingNames: readonly string[];
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<void> {
  const { logger, CliError } = getContext();
  const {
    credentials,
    resourceGroupName,
    appServiceName,
    settingNames,
    timeoutMs = AZURE_KEY_VAULT_REFERENCE_WAIT.timeoutMs,
    intervalMs = AZURE_KEY_VAULT_REFERENCE_WAIT.intervalMs,
  } = options;

  const client = new WebSiteManagementClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );
  const fatal: readonly string[] = AZURE_KEY_VAULT_REFERENCE_FATAL_STATUSES;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const references = await Promise.all(
      settingNames.map(async (name) => {
        const reference = await client.webApps.getAppSettingKeyVaultReference(
          resourceGroupName,
          appServiceName,
          name,
        );
        return { name, status: reference.status ?? 'Initialized' };
      }),
    );
    const pending = references.filter(({ status }) => status !== 'Resolved');
    if (pending.length === 0) {
      logger.success(
        `  All ${settingNames.length} Key Vault references resolved`,
      );
      return;
    }

    const describe = (list: typeof pending): string =>
      list.map(({ name, status }) => `${name} (${status})`).join(', ');

    const failed = pending.filter(({ status }) => fatal.includes(status));
    if (failed.length > 0) {
      throw new CliError(
        `${appServiceName}: Key Vault references cannot resolve: ${describe(failed)}`,
        'Key Vault references',
        'Check that the secrets exist in the shared Key Vault (cloud-secrets:push, and infra:deploy for REDIS_PASSWORD) and that the app has a managed identity',
      );
    }
    if (Date.now() >= deadline) {
      throw new CliError(
        `${appServiceName}: Key Vault references not resolved after ${Math.round(timeoutMs / 60000)} minutes: ${describe(pending)}`,
        'Key Vault references',
        'A new role assignment can take a while to apply. Run the deploy again.',
      );
    }

    logger.info(`  Waiting for Key Vault access: ${describe(pending)}`);
    await sleep(intervalMs);
    // References resolve when the app starts
    await client.webApps.restart(resourceGroupName, appServiceName);
  }
}
