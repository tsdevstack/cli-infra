/**
 * Build the fixed URL of a Cloud Run service
 */

import { GCP_RUN_APP_HOST_LABEL_MAX_LENGTH } from '@tsdevstack/infra-core';
import { getContext } from '../../context';

/**
 * `https://{name}-{project number}.{region}.run.app`: the URL Cloud Run
 * gives a service when `{name}-{project number}` fits one DNS label (63
 * characters). The `{SERVICE}_URL` secrets, Kong's routes and the
 * scheduler's audience use it, so a name too long stops here instead of
 * leaving the service unreachable.
 *
 * @param cloudRunName - The service's Cloud Run name
 * @param projectNumber - The GCP project number
 * @param region - The GCP region
 * @param commandName - Command name for the error
 * @returns The service URL
 */
export function buildGcpCloudRunUrl(
  cloudRunName: string,
  projectNumber: string,
  region: string,
  commandName: string,
): string {
  const { CliError } = getContext();

  const label = `${cloudRunName}-${projectNumber}`;
  if (label.length > GCP_RUN_APP_HOST_LABEL_MAX_LENGTH) {
    throw new CliError(
      `Cloud Run gives "${cloudRunName}" no fixed URL: "${label}" is ${label.length} characters, over ${GCP_RUN_APP_HOST_LABEL_MAX_LENGTH}`,
      commandName,
      'Kong, the scheduler and other services reach a service by its fixed URL. Shorten the project name in .tsdevstack/config.json or the service name.',
    );
  }
  return `https://${label}.${region}.run.app`;
}
