/**
 * Key Vault access for Kong's App Service (its runtime secrets)
 */

/** Built-in role that reads secret values (Key Vault with RBAC authorization) */
export const AZURE_KEY_VAULT_SECRETS_USER_ROLE_ID =
  '4633458b-17de-408a-b874-0445c86b69e6';

/** ARM API version for role assignments */
export const AZURE_ROLE_ASSIGNMENTS_API_VERSION = '2022-04-01';

/**
 * How long a deploy waits for App Service to resolve Key Vault references: a
 * new role assignment can take minutes to apply
 */
export const AZURE_KEY_VAULT_REFERENCE_WAIT = {
  timeoutMs: 10 * 60 * 1000,
  intervalMs: 20 * 1000,
} as const;

/** Key Vault reference states that waiting does not fix */
export const AZURE_KEY_VAULT_REFERENCE_FATAL_STATUSES = [
  'InvalidSyntax',
  'MSINotEnabled',
  'VaultNotFound',
  'SecretNotFound',
  'SecretVersionNotFound',
] as const;
