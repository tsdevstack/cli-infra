/**
 * Build Cloud Map URL
 *
 * The URL a service is reached at inside the VPC through Cloud Map:
 * http://{name}.{project}.local:8080. Kong calls the backends there, the
 * Next.js servers call Kong there (KONG_INTERNAL_URL), and services call
 * each other there.
 */

import {
  AWS_CLOUD_MAP_NAMESPACE_SUFFIX,
  AWS_CONTAINER_PORT,
} from '../../constants';

/**
 * @param name - The service's Cloud Map name (its service name, or Kong's)
 * @param projectName - Project name (the namespace is {project}.local)
 * @returns The in-VPC URL
 */
export function buildCloudMapUrl(name: string, projectName: string): string {
  return `http://${name}.${projectName}${AWS_CLOUD_MAP_NAMESPACE_SUFFIX}:${AWS_CONTAINER_PORT}`;
}
