/**
 * Get App Runner Service Details (AWS)
 *
 * Fetches detailed information about a specific App Runner service.
 */

import {
  AppRunnerClient,
  ListServicesCommand,
  DescribeServiceCommand,
} from '@aws-sdk/client-apprunner';
import { buildAWSClientConfig } from '../build-aws-client-config';
import type { AWSCredentials } from 'tsdevstack/plugin';

export interface GetAppRunnerServiceOptions {
  projectName: string;
  targetEnv: string;
  serviceName: string;
  credentials: AWSCredentials;
}

export interface AppRunnerServiceDetails {
  exists: boolean;
  serviceName: string;
  status: string;
  serviceUrl?: string;
  serviceArn?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface GetAppRunnerServiceResult {
  success: boolean;
  service: AppRunnerServiceDetails;
  error?: string;
}

/**
 * Get detailed information about a specific App Runner service
 */
export async function getAppRunnerService(
  options: GetAppRunnerServiceOptions,
): Promise<GetAppRunnerServiceResult> {
  const { projectName, targetEnv, serviceName, credentials } = options;

  const clientConfig = buildAWSClientConfig(credentials);
  const client = new AppRunnerClient(clientConfig);

  // App Runner services are named: {project}-{env}-{service}
  const fullServiceName = `${projectName}-${targetEnv}-${serviceName}`;

  try {
    // First, list services to find the ARN
    const listCommand = new ListServicesCommand({});
    const listResponse = await client.send(listCommand);

    const serviceEntry = listResponse.ServiceSummaryList?.find(
      (s) => s.ServiceName === fullServiceName,
    );

    if (!serviceEntry || !serviceEntry.ServiceArn) {
      return {
        success: true,
        service: {
          exists: false,
          serviceName,
          status: 'NOT_FOUND',
        },
      };
    }

    // Get detailed service info
    const describeCommand = new DescribeServiceCommand({
      ServiceArn: serviceEntry.ServiceArn,
    });
    const describeResponse = await client.send(describeCommand);

    const service = describeResponse.Service;

    return {
      success: true,
      service: {
        exists: true,
        serviceName,
        status: service?.Status ?? 'UNKNOWN',
        serviceUrl: service?.ServiceUrl,
        serviceArn: service?.ServiceArn,
        createdAt: service?.CreatedAt,
        updatedAt: service?.UpdatedAt,
      },
    };
  } catch (error) {
    return {
      success: false,
      service: {
        exists: false,
        serviceName,
        status: 'ERROR',
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
