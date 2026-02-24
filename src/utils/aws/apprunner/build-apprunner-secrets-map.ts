/**
 * Build App Runner Secrets Map
 *
 * Discovers secrets in AWS Secrets Manager for a given service and builds
 * the env var name → ARN mapping for App Runner's RuntimeEnvironmentSecrets.
 *
 * Searches both shared secrets ({project}-shared-*) and service-scoped
 * secrets ({project}-{service}-*). The env var name is extracted from
 * the secret name using the standard naming convention.
 */

import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { listSecretsByPrefix } from '../discovery/list-secrets-by-prefix';

export interface BuildAppRunnerSecretsMapOptions {
  credentials: AWSCredentials;
  projectName: string;
  serviceName: string;
}

export interface BuildAppRunnerSecretsMapResult {
  success: boolean;
  /** Map of env var name → Secrets Manager ARN */
  secrets: Record<string, string>;
  error?: string;
}

/**
 * Extract the env var KEY from a secret name
 *
 * Secret format: {projectName}-{scope}-{KEY}
 * - scope is lowercase-with-hyphens (e.g., "shared", "auth-service")
 * - KEY is UPPERCASE_WITH_UNDERSCORES (e.g., "DATABASE_URL")
 * - The boundary is the last hyphen before the first uppercase letter
 */
function extractKeyFromSecretName(
  secretName: string,
  prefix: string,
): string | null {
  if (!secretName.startsWith(prefix)) {
    return null;
  }

  // Remove prefix: "DATABASE_URL" or "auth-service-DATABASE_URL"
  const rest = secretName.substring(prefix.length);

  // Find the KEY part (starts with uppercase, only uppercase + digits + underscores)
  const match = rest.match(/^(.+-)?([A-Z][A-Z0-9_]*)$/);
  if (!match) {
    return null;
  }

  return match[2];
}

/**
 * Build the secrets map for an App Runner service
 *
 * Discovers all secrets in Secrets Manager matching the project's naming
 * convention and returns a map suitable for RuntimeEnvironmentSecrets.
 */
export async function buildAppRunnerSecretsMap(
  options: BuildAppRunnerSecretsMapOptions,
): Promise<BuildAppRunnerSecretsMapResult> {
  const { credentials, projectName, serviceName } = options;
  const secrets: Record<string, string> = {};

  // Search for shared secrets: {project}-shared-*
  const sharedPrefix = `${projectName}-shared-`;
  const sharedResult = await listSecretsByPrefix({
    credentials,
    prefix: sharedPrefix,
  });

  if (!sharedResult.success) {
    return {
      success: false,
      secrets: {},
      error: `Failed to list shared secrets: ${sharedResult.error}`,
    };
  }

  for (const secret of sharedResult.secrets) {
    const key = extractKeyFromSecretName(secret.name, sharedPrefix);
    if (key) {
      secrets[key] = secret.arn;
    }
  }

  // Search for service-scoped secrets: {project}-{service}-*
  const servicePrefix = `${projectName}-${serviceName}-`;
  const serviceResult = await listSecretsByPrefix({
    credentials,
    prefix: servicePrefix,
  });

  if (!serviceResult.success) {
    return {
      success: false,
      secrets: {},
      error: `Failed to list service secrets: ${serviceResult.error}`,
    };
  }

  for (const secret of serviceResult.secrets) {
    const key = extractKeyFromSecretName(secret.name, servicePrefix);
    if (key) {
      // Service-scoped secrets override shared secrets with the same key
      secrets[key] = secret.arn;
    }
  }

  return {
    success: true,
    secrets,
  };
}
