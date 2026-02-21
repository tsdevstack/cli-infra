/**
 * List App Runner Services
 *
 * Lists all App Runner services with their status.
 * Used for Next.js deployments.
 */

import {
  AppRunnerClient,
  ListServicesCommand,
} from '@aws-sdk/client-apprunner';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

export interface ListAppRunnerServicesOptions {
  projectName: string;
  credentials: AWSCredentials;
}

export interface AppRunnerServiceInfo {
  /** Full service name (e.g., tsdevstack-frontend) */
  name: string;
  /** Service name without project prefix (e.g., frontend) */
  serviceName: string;
  status: string;
  serviceUrl?: string;
}

export interface ListAppRunnerServicesResult {
  success: boolean;
  services: AppRunnerServiceInfo[];
  error?: string;
}

/**
 * List all App Runner services for a project
 */
export async function listAppRunnerServices(
  options: ListAppRunnerServicesOptions,
): Promise<ListAppRunnerServicesResult> {
  const { projectName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new AppRunnerClient(clientConfig);

  try {
    const response = await client.send(new ListServicesCommand({}));

    const allServices = response.ServiceSummaryList ?? [];

    // Filter to services matching our project prefix
    const projectServices = allServices.filter((service) =>
      service.ServiceName?.startsWith(`${projectName}-`),
    );

    const services: AppRunnerServiceInfo[] = projectServices.map((service) => {
      const fullName = service.ServiceName ?? '';
      const serviceName = fullName.startsWith(`${projectName}-`)
        ? fullName.slice(projectName.length + 1)
        : fullName;

      return {
        name: fullName,
        serviceName,
        status: service.Status ?? 'UNKNOWN',
        serviceUrl: service.ServiceUrl,
      };
    });

    return { success: true, services };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, services: [], error: message };
  }
}
