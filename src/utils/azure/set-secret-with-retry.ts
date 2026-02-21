/**
 * Set a secret via CLI with exponential backoff retry
 *
 * Azure Key Vault RBAC propagation takes 1-5 minutes after Terraform
 * creates role assignments. This wrapper retries setSecretViaCli to
 * handle the propagation delay on fresh Azure deployments.
 */

import { setSecretViaCli } from '../credentials/set-secret-via-cli';

/**
 * Set a secret via CLI with exponential backoff retry for Azure RBAC propagation
 *
 * @param key - Secret key
 * @param value - Secret value
 * @param env - Target environment
 * @param service - Optional service scope
 */
export async function setSecretWithRetry(
  key: string,
  value: string,
  env: string,
  service?: string,
): Promise<void> {
  const maxRetries = 12;
  const initialDelayMs = 10_000;
  const maxDelayMs = 60_000;
  const backoffFactor = 2;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      setSecretViaCli(key, value, env, service);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        break;
      }

      const delayMs = Math.min(
        initialDelayMs * Math.pow(backoffFactor, attempt),
        maxDelayMs,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
