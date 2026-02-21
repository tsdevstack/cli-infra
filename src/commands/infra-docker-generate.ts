/**
 * infra:generate-docker Command
 *
 * Generates Dockerfiles for deployable services.
 */

import path from 'node:path';
import { getContext } from '../context';
import {
  generateNestJsDockerfile,
  generateNextJsDockerfile,
  getServiceWorkspaceDeps,
  validateNextjsStandalone,
} from '../utils/docker';
import { DEPLOYABLE_SERVICE_TYPES } from '../constants';

interface InfraDockerGenerateOptions {
  service?: string;
}

/**
 * Generate Dockerfiles for services
 */
export async function infraDockerGenerate(
  options: InfraDockerGenerateOptions,
): Promise<void> {
  const {
    logger,
    loadFrameworkConfig,
    findProjectRoot,
    CliError,
    ensureDirectory,
    writeTextFile,
  } = getContext();

  logger.newline();

  const projectRoot = findProjectRoot();
  const config = loadFrameworkConfig();
  const outputDir = path.join(projectRoot, 'infrastructure', 'docker');

  // Get deployable services
  let services = config.services.filter((s) =>
    (DEPLOYABLE_SERVICE_TYPES as readonly string[]).includes(s.type),
  );

  // Filter by specific service if provided
  if (options.service) {
    services = services.filter((s) => s.name === options.service);

    if (services.length === 0) {
      const allServices = config.services.filter((s) =>
        (DEPLOYABLE_SERVICE_TYPES as readonly string[]).includes(s.type),
      );
      throw new CliError(
        `Service "${options.service}" not found or not deployable`,
        'infra:generate-docker',
        `Deployable services: ${allServices.map((s) => s.name).join(', ')}`,
      );
    }
  }

  if (services.length === 0) {
    logger.warn('No deployable services found (nestjs or nextjs types)');
    return;
  }

  // Create output directory
  ensureDirectory(outputDir);

  logger.info(`Output: ${outputDir}`);
  logger.info(`Services: ${services.map((s) => s.name).join(', ')}`);
  logger.newline();
  logger.generating('Generating Dockerfiles...');

  for (const service of services) {
    // Get workspace packages this service actually depends on
    const workspacePackages = getServiceWorkspaceDeps(
      projectRoot,
      service.name,
    );

    if (service.type === 'nestjs') {
      const content = generateNestJsDockerfile({
        serviceName: service.name,
        workspacePackages,
        hasDatabase: service.hasDatabase ?? false,
      });
      const filePath = path.join(outputDir, `${service.name}.Dockerfile`);
      writeTextFile(filePath, content);
      logger.success(
        `  ${service.name}.Dockerfile (NestJS) [deps: ${workspacePackages.length}]`,
      );
    } else if (service.type === 'nextjs') {
      // Validate standalone output is configured
      validateNextjsStandalone(projectRoot, service.name);

      const content = generateNextJsDockerfile({
        serviceName: service.name,
        workspacePackages,
      });
      const filePath = path.join(outputDir, `${service.name}.Dockerfile`);
      writeTextFile(filePath, content);
      logger.success(
        `  ${service.name}.Dockerfile (Next.js) [deps: ${workspacePackages.length}]`,
      );
    }
  }

  // Report skipped services
  const skippedServices = config.services.filter(
    (s) => !(DEPLOYABLE_SERVICE_TYPES as readonly string[]).includes(s.type),
  );
  if (skippedServices.length > 0) {
    logger.newline();
    logger.info(
      `Skipped (not containerized): ${skippedServices.map((s) => `${s.name} (${s.type})`).join(', ')}`,
    );
  }

  logger.newline();
  logger.complete('Dockerfiles generated!');
  logger.newline();
  logger.info('Next steps:');
  logger.info('  npx tsdevstack infra:build-docker');
  logger.info('  npx tsdevstack infra:push-docker');
  logger.newline();
}
