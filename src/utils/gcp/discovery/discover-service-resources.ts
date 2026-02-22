/**
 * Discover Service Resources
 *
 * Orchestrates all discovery calls to determine what cloud resources
 * exist for a service. Infers service type from discovered resources.
 *
 * Cloud is the source of truth - this allows removal even if service
 * has already been removed from config.json.
 */

import type { GCPCredentials } from 'tsdevstack/plugin';
import { cloudRunServiceExists } from './cloud-run-service-exists';
import { bucketExists } from './bucket-exists';
import { listSecretsByPrefix } from './list-secrets-by-prefix';
import { serviceAccountExists } from './service-account-exists';
import { databaseExists } from './database-exists';

export interface DiscoverServiceResourcesOptions {
  serviceName: string;
  projectName: string;
  projectId: string;
  region: string;
  sqlInstanceName: string;
  credentials: GCPCredentials;
}

export interface DiscoveredResources {
  cloudRunService: boolean;
  cloudRunServiceUrl?: string;
  spaBucket: boolean;
  spaBucketName: string;
  database: boolean;
  databaseUser: boolean;
  secrets: string[];
  serviceAccount: boolean;
  serviceAccountEmail: string;
  /**
   * Inferred type based on discovered resources:
   * - 'backend': Cloud Run service exists (could be NestJS, Next.js, or other)
   * - 'spa': Only SPA bucket exists (no Cloud Run)
   * - 'unknown': No resources found
   */
  inferredType: 'backend' | 'spa' | 'unknown';
  /**
   * True if database exists (regardless of service type in config)
   */
  hasDatabase: boolean;
}

/**
 * Discover all cloud resources for a service
 *
 * Queries GCP to find what resources exist, regardless of what's in config.json.
 * This allows removal even if service was already removed from config locally.
 */
export async function discoverServiceResources(
  options: DiscoverServiceResourcesOptions,
): Promise<DiscoveredResources> {
  const {
    serviceName,
    projectName,
    projectId,
    region,
    credentials,
    sqlInstanceName,
  } = options;

  const spaBucketName = `${projectName}-${serviceName}-spa`;
  const serviceAccountEmail = `${projectName}-${serviceName}-rt@${projectId}.iam.gserviceaccount.com`;

  // Run all discovery calls in parallel for performance
  const [
    cloudRunResult,
    bucketResult,
    secretsResult,
    databaseResult,
    serviceAccountResult,
  ] = await Promise.all([
    cloudRunServiceExists({
      serviceName,
      projectId,
      region,
      credentials,
    }),
    bucketExists({
      bucketName: spaBucketName,
      credentials,
    }),
    listSecretsByPrefix({
      projectId,
      prefix: `${projectName}-${serviceName}-`,
      credentials,
    }),
    databaseExists({
      databaseName: serviceName,
      instanceName: sqlInstanceName,
      projectId,
      credentials,
    }),
    serviceAccountExists({
      serviceAccountEmail,
      projectId,
      credentials,
    }),
  ]);

  const hasCloudRun = cloudRunResult.exists;
  const hasBucket = bucketResult.exists;
  const hasDatabase = databaseResult.exists;

  // Infer type from discovered resources
  // Cloud Run = backend (could be NestJS, Next.js, or other)
  // Bucket only = spa
  // Neither = unknown
  let inferredType: 'backend' | 'spa' | 'unknown' = 'unknown';
  if (hasCloudRun) {
    inferredType = 'backend';
  } else if (hasBucket) {
    inferredType = 'spa';
  }

  return {
    cloudRunService: hasCloudRun,
    cloudRunServiceUrl: cloudRunResult.serviceUrl,
    spaBucket: hasBucket,
    spaBucketName,
    database: hasDatabase,
    databaseUser: hasDatabase, // Assume user exists if database exists
    secrets: secretsResult.success
      ? secretsResult.secrets.map((s) => s.name)
      : [],
    serviceAccount: serviceAccountResult.exists,
    serviceAccountEmail,
    inferredType,
    hasDatabase,
  };
}
