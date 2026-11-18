/**
 * Container Apps secret read from Key Vault
 */

/**
 * A Container Apps secret with this keyVaultUrl gets the secret's value:
 * Container Apps fetches it with the identity named next to it. Without a
 * version it follows the latest one.
 *
 * @param keyVaultName - Vault name
 * @param secretName - Secret name as stored in the vault (hyphens)
 * @returns The secret's URL
 */
export function buildKeyVaultSecretUrl(
  keyVaultName: string,
  secretName: string,
): string {
  return `https://${keyVaultName}.vault.azure.net/secrets/${secretName}`;
}
