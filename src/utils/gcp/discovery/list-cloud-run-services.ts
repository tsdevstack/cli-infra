/**
 * List Cloud Run services in a region
 *
 * Uses @google-cloud/run ServicesClient to list all services.
 */

import { ServicesClient } from '@google-cloud/run';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';

export interface ListCloudRunServicesOptions {
  projectId: string;
  region: string;
  credentials: GCPCredentials;
  /** Optional prefix to filter services (e.g., projectName to get only framework services) */
  prefix?: string;
}

export interface CloudRunServiceInfo {
  /** Short service name (e.g., "auth-service") */
  name: string;
  /** Full resource name (e.g., "projects/xxx/locations/xxx/services/auth-service") */
  fullName: string;
  /** Service URL if available */
  url?: string;
  /** Service account email used by this service */
  serviceAccount?: string;
  /** Container image URI (e.g., "us-docker.pkg.dev/project/repo/image:tag") */
  imageUri?: string;
  /** Reconciliation status (e.g., "Active", "Unknown") */
  status?: string;
}

export interface ListCloudRunServicesResult {
  success: boolean;
  services: CloudRunServiceInfo[];
  error?: string;
}

/**
 * List all Cloud Run services in a region
 *
 * @param options - Project, region, and credentials
 * @returns List of services found
 */
export async function listCloudRunServices(
  options: ListCloudRunServicesOptions,
): Promise<ListCloudRunServicesResult> {
  const { buildGCPClientOptions } = getContext();

  const client = new ServicesClient(buildGCPClientOptions(options.credentials));
  const parent = `projects/${options.projectId}/locations/${options.region}`;

  try {
    const services: CloudRunServiceInfo[] = [];

    // listServicesAsync returns an async iterable
    // Setting autoPaginate: false suppresses the AutopaginateTrueWarning
    const iterable = client.listServicesAsync(
      { parent },
      { autoPaginate: false },
    );

    for await (const service of iterable) {
      // Extract short name from full resource name
      // Format: projects/{project}/locations/{region}/services/{name}
      const fullName = service.name ?? '';
      const shortName = fullName.split('/').pop() ?? '';

      // Skip if prefix filter is specified and doesn't match
      if (options.prefix && !shortName.startsWith(options.prefix)) {
        continue;
      }

      // Extract container image from template
      const containers = service.template?.containers ?? [];
      const imageUri =
        containers.length > 0 ? (containers[0].image ?? undefined) : undefined;

      // Derive status from conditions
      // Cloud Run conditions: "Ready" condition reflects overall status
      const conditions = service.conditions ?? [];
      const readyCondition = conditions.find((c) => c.type === 'Ready');
      let status = 'UNKNOWN';
      if (readyCondition?.state === 'CONDITION_SUCCEEDED') {
        status = 'SERVING';
      } else if (readyCondition?.state === 'CONDITION_FAILED') {
        status = 'FAILED';
      } else if (service.reconciling) {
        status = 'DEPLOYING';
      }

      services.push({
        name: shortName,
        fullName,
        url: service.uri ?? undefined,
        serviceAccount: service.template?.serviceAccount ?? undefined,
        imageUri,
        status,
      });
    }

    return {
      success: true,
      services,
    };
  } catch (error: unknown) {
    return {
      success: false,
      services: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
