/**
 * Kong's runtime secrets by their names in the shared Key Vault
 */

import { getContext } from '../../../context';

/**
 * Kong's runtime secrets and their names in the shared vault, where Azure
 * stores underscores as hyphens. The deploy grants Kong read access to these
 * and the destroy removes it.
 *
 * @param projectName - Project name (secret name prefix)
 * @returns One entry per secret: the framework key and its name in the vault
 */
export function buildKongVaultSecretNames(
  projectName: string,
): Array<{ key: string; secretName: string }> {
  const { KONG_RUNTIME_SECRETS, buildSecretName, SHARED_SECRET_SCOPE } =
    getContext();
  return KONG_RUNTIME_SECRETS.map((key) => ({
    key,
    secretName: buildSecretName(projectName, SHARED_SECRET_SCOPE, key).replace(
      /_/g,
      '-',
    ),
  }));
}
