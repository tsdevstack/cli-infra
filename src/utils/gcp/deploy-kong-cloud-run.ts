/**
 * Deploy Kong Gateway to Cloud Run
 *
 * Kong requires special configuration:
 * - Ingress: INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER
 * - Status probe on port 8100 (Kong status API)
 * All config values are baked into kong.yml at Docker image build time.
 */

import { ServicesClient } from '@google-cloud/run';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';

export interface KongDeployOptions {
  projectId: string;
  projectName: string;
  region: string;
  imageUri: string;
  // Direct VPC Egress - Kong gets IP directly in subnet
  vpcNetwork: string; // e.g., "projects/xxx/global/networks/tsdevstack-vpc"
  vpcSubnet: string; // e.g., "projects/xxx/regions/us-central1/subnetworks/tsdevstack-subnet"
  serviceAccount: string;
  credentials: GCPCredentials;
  minInstances: number;
  maxInstances: number;
  cpu: string;
  memory: string;
}

export interface KongDeployResult {
  success: boolean;
  serviceUrl?: string;
  error?: string;
}

/**
 * Deploy Kong Gateway to Cloud Run
 */
export async function deployKongCloudRun(
  options: KongDeployOptions,
): Promise<KongDeployResult> {
  const { logger, CliError, buildGCPClientOptions } = getContext();

  const servicesClient = new ServicesClient(
    buildGCPClientOptions(options.credentials),
  );

  const parent = `projects/${options.projectId}/locations/${options.region}`;
  const serviceName = `${parent}/services/${options.projectName}-kong`;

  // Build template config (use Record to avoid strict type issues with SDK)
  const templateConfig: Record<string, unknown> = {
    serviceAccount: options.serviceAccount,
    scaling: {
      minInstanceCount: options.minInstances,
      maxInstanceCount: options.maxInstances,
    },
    containers: [
      {
        image: options.imageUri,
        ports: [{ containerPort: 8080 }],
        resources: {
          limits: {
            cpu: options.cpu,
            memory: options.memory,
          },
          // CPU only allocated during request processing (request-based billing, cheaper)
          // When false, CPU is always allocated even when idle (instance-based billing, expensive)
          cpuIdle: true,
        },
        // Startup probe - TCP check on proxy port
        startupProbe: {
          tcpSocket: {
            port: 8080,
          },
          initialDelaySeconds: 5,
          periodSeconds: 5,
          failureThreshold: 12, // 12 * 5s = 60s max startup
        },
        // No liveness probe - Cloud Run doesn't support TCP for liveness
      },
    ],
    timeout: { seconds: 30 },
    maxInstanceRequestConcurrency: 1000,
    // Direct VPC Egress for reaching internal services and Redis
    // PRIVATE_RANGES_ONLY: Routes RFC 1918 + 199.36.153.x through VPC
    // Cloud DNS resolves *.run.app to 199.36.153.x (private range)
    // so service-to-service calls route through VPC as internal traffic
    vpcAccess: {
      networkInterfaces: [
        {
          network: options.vpcNetwork,
          subnetwork: options.vpcSubnet,
        },
      ],
      egress: 'PRIVATE_RANGES_ONLY',
    },
  };

  // Service configuration
  const serviceConfig = {
    name: serviceName,
    // Internal + load balancer ingress for LB integration
    ingress: 'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER' as const,
    template: templateConfig,
  };

  // Deploy service
  logger.info(`Deploying Kong to Cloud Run: ${options.projectName}-kong...`);
  try {
    const [operation] = await servicesClient.updateService({
      service: serviceConfig,
      allowMissing: true,
    });

    logger.info('Waiting for deployment to complete...');
    const [service] = await operation.promise();

    return {
      success: true,
      serviceUrl: service.uri ?? undefined,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    throw new CliError(
      `Failed to deploy Kong to Cloud Run`,
      'infra:deploy-kong',
      errorMessage,
    );
  }
}
