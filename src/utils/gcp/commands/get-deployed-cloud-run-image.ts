import { ServicesClient } from '@google-cloud/run';
import { getContext } from '../../../context';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';

/** gRPC NOT_FOUND */
const NOT_FOUND = 5;

/**
 * The image a deployed Cloud Run service runs (its first container's), or
 * undefined when the service doesn't exist. deploy-schedulers gives a cron
 * job the image its service runs, so no build or tag is needed there.
 *
 * @param credentials - The environment's GCP credentials
 * @param cloudRunName - The service's Cloud Run name (buildGcpCloudRunName)
 */
export async function getDeployedCloudRunImage(
  credentials: GCPCredentials,
  cloudRunName: string,
): Promise<string | undefined> {
  const { buildGCPClientOptions } = getContext();
  const client = new ServicesClient(buildGCPClientOptions(credentials));
  const name = `projects/${credentials.project_id}/locations/${credentials.region}/services/${cloudRunName}`;
  try {
    const [service] = await client.getService({ name });
    return service.template?.containers?.[0]?.image ?? undefined;
  } catch (error) {
    if ((error as { code?: number }).code === NOT_FOUND) {
      return undefined;
    }
    throw error;
  }
}
