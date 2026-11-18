/**
 * Resolve a GCP environment's naming scheme
 */

import { Storage } from '@google-cloud/storage';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import type { NamingScheme } from '@tsdevstack/infra-core';
import { getContext } from '../../../context';
import { GCP_TERRAFORM_STATE_FILE, GCS_JSON_API_URL } from '../../../constants';
import { buildGcpStateBucketName } from '../build-gcp-state-bucket-name';
import { isGcpNotFoundError } from '../is-gcp-not-found-error';
import { detectNamingScheme } from '../../naming/detect-naming-scheme';

/**
 * Read the environment's Terraform state from the state bucket (with the
 * SDK: `infra:generate` runs before `terraform init`, in CI too) and tell
 * which names the environment uses. A missing bucket or state file (404)
 * means nothing is deployed. Any other failure stops the command: a guess
 * could recreate a deployed environment's services under new names.
 *
 * The state is read with one authenticated GET through the SDK's own auth
 * client, not `file.download()`: the SDK's download stream gets more error
 * and close listeners than Node's default of 10, and Node prints a
 * MaxListenersExceededWarning on every command (@google-cloud/storage 8.4.0).
 *
 * @param ctx - Project name, environment and credentials
 * @param commandName - Command name for the error
 * @returns The environment's naming scheme
 */
export async function resolveGcpNamingScheme(
  ctx: {
    projectName: string;
    targetEnv: string;
    credentials: GCPCredentials;
  },
  commandName: string,
): Promise<NamingScheme> {
  const { CliError, buildGCPClientOptions } = getContext();

  const bucketName = buildGcpStateBucketName(
    ctx.projectName,
    ctx.credentials.project_id,
  );
  const objectName = `${ctx.targetEnv}/${GCP_TERRAFORM_STATE_FILE}`;
  const storage = new Storage(buildGCPClientOptions(ctx.credentials));

  let content: string | undefined;
  try {
    const response = await storage.authClient.request<string>({
      url: `${GCS_JSON_API_URL}/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectName)}?alt=media`,
      responseType: 'text',
    });
    content = response.data;
  } catch (error) {
    if (isGcpNotFoundError(error)) {
      return detectNamingScheme(undefined, commandName);
    }
    throw new CliError(
      `Could not read the Terraform state gs://${bucketName}/${objectName}: ${error instanceof Error ? error.message : String(error)}`,
      commandName,
      'The CLI reads the state to keep the names this environment was deployed with, and stops rather than guess. Check that the credentials can read the state bucket (roles/storage.objectViewer), then run the command again.',
    );
  }

  if (content === undefined) {
    return detectNamingScheme(undefined, commandName);
  }

  let state: unknown;
  try {
    state = JSON.parse(content);
  } catch {
    throw new CliError(
      `The Terraform state gs://${bucketName}/${objectName} is not valid JSON`,
      commandName,
      'The CLI reads the state to keep the names this environment was deployed with. Check the state file in the bucket.',
    );
  }

  return detectNamingScheme(state, commandName);
}
