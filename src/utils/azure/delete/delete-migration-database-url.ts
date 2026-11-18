/**
 * Delete a removed service's MIGRATION_DATABASE_URL (Azure remove-service)
 */

import { getContext } from '../../../context';
import type { AzureCommandContext } from '../commands/types';
import type { DeletionStepResult } from '../remove-service/types';
import { deleteKeyVaultSecretsByPrefix } from './delete-keyvault-secrets-by-prefix';

export interface DeleteMigrationDatabaseUrlOptions {
  ctx: AzureCommandContext;
  serviceName: string;
}

/**
 * The owner's URL lives in the database jobs' vault, not the service's, so
 * the service's other secret steps don't reach it. Matched by its exact
 * name: a shorter prefix could take another service's secret. Nothing to do
 * when the vault doesn't exist (an environment not converted yet).
 */
export async function deleteMigrationDatabaseUrl(
  options: DeleteMigrationDatabaseUrlOptions,
): Promise<DeletionStepResult> {
  const { ctx, serviceName } = options;
  const {
    keyVaultExists,
    resolveKeyVaultName,
    buildSecretName,
    MIGRATION_DATABASE_URL_KEY,
    AZURE_DB_JOBS_KEY_VAULT_SCOPE,
  } = getContext();

  if (
    !(await keyVaultExists(
      ctx.credentials,
      ctx.projectName,
      ctx.targetEnv,
      AZURE_DB_JOBS_KEY_VAULT_SCOPE,
    ))
  ) {
    return { success: true, deleted: false };
  }

  const result = await deleteKeyVaultSecretsByPrefix({
    credentials: ctx.credentials,
    vaultName: await resolveKeyVaultName(
      ctx.credentials,
      ctx.projectName,
      ctx.targetEnv,
      AZURE_DB_JOBS_KEY_VAULT_SCOPE,
    ),
    // Key Vault names use hyphens
    prefix: buildSecretName(
      ctx.projectName,
      serviceName,
      MIGRATION_DATABASE_URL_KEY,
    ).replace(/_/g, '-'),
  });
  return {
    success: result.success,
    deleted: result.totalDeleted > 0,
    error: result.error,
  };
}
