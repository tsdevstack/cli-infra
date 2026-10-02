/**
 * AWS List Deployed Services
 *
 * Discover and list ALL deployed services in an AWS environment.
 */

import { getContext } from '../../../context';
import { discoverDeployedServices } from '../discovery';
import { parseImageTag } from '../../display/parse-image-tag';
import { padRight } from '../../display/pad-right';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

interface AwsListDeployedParams {
  projectName: string;
  targetEnv: string;
  credentials: AWSCredentials;
}

/**
 * Format AWS resources into readable string
 */
function formatAwsResources(resources: {
  ecsService?: boolean;
  spaBucket: boolean;
  runningCount?: number;
  desiredCount?: number;
}): string {
  const parts: string[] = [];

  if (resources.ecsService) {
    parts.push(
      `ECS (${resources.runningCount ?? 0}/${resources.desiredCount ?? 0})`,
    );
  }
  if (resources.spaBucket) {
    parts.push('S3 + CloudFront');
  }

  return parts.length > 0 ? parts.join(', ') : 'none';
}

/**
 * List all deployed services in an AWS environment
 */
export async function awsListDeployed(
  params: AwsListDeployedParams,
): Promise<void> {
  const { logger, CliError } = getContext();
  const { projectName, targetEnv, credentials } = params;

  logger.info('Discovering deployed services...');
  logger.newline();

  const result = await discoverDeployedServices({
    projectName,
    credentials,
  });

  if (!result.success) {
    throw new CliError(
      'Failed to discover deployed services',
      'infra:list-deployed',
      result.error ?? 'Unknown error',
    );
  }

  if (result.services.length === 0) {
    logger.warn('No deployed services found in this environment.');
    logger.newline();
    return;
  }

  // Display results as table
  logger.info(`Deployed services in ${targetEnv}:`);
  logger.newline();

  // Calculate column widths
  const nameWidth = Math.max(
    'NAME'.length,
    ...result.services.map((s) => s.name.length),
  );
  const typeWidth = Math.max(
    'TYPE'.length,
    ...result.services.map((s) => s.type.length),
  );
  const statusWidth = Math.max(
    'STATUS'.length,
    ...result.services.map((s) => s.status.length),
  );
  const imageTags = result.services.map((s) => parseImageTag(s.imageUri));
  const imageWidth = Math.max(
    'IMAGE'.length,
    ...imageTags.map((t) => t.length),
  );

  // Header
  const header = `  ${padRight('NAME', nameWidth)}  ${padRight('TYPE', typeWidth)}  ${padRight('STATUS', statusWidth)}  ${padRight('IMAGE', imageWidth)}  RESOURCES`;
  logger.info(header);
  logger.info('  ' + '-'.repeat(header.length - 2));

  // Rows
  for (let i = 0; i < result.services.length; i++) {
    const service = result.services[i];
    const resources = formatAwsResources(service.resources);
    const imageTag = imageTags[i];
    const row = `  ${padRight(service.name, nameWidth)}  ${padRight(service.type, typeWidth)}  ${padRight(service.status, statusWidth)}  ${padRight(imageTag, imageWidth)}  ${resources}`;
    logger.info(row);
  }

  logger.newline();
  logger.info(
    `Total: ${result.services.length} service${result.services.length === 1 ? '' : 's'}`,
  );
  logger.newline();
}
