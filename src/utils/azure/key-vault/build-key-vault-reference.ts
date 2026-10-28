/**
 * App Service setting value read from Key Vault
 */

/**
 * An App Service setting with this value gets the secret's value instead:
 * App Service reads it with the app's identity when the app starts.
 *
 * @param keyVaultName - Vault name
 * @param secretName - Secret name as stored in the vault (hyphens)
 * @returns The Key Vault reference
 */
export function buildKeyVaultReference(
  keyVaultName: string,
  secretName: string,
): string {
  return `@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=${secretName})`;
}
