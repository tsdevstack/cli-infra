/**
 * AWS Cloud Map constants
 */

/**
 * DNS suffix of the Cloud Map namespace: services register as
 * `{service}.{project}{suffix}` inside the VPC.
 */
export const AWS_CLOUD_MAP_NAMESPACE_SUFFIX = '.local';

/**
 * Port every container listens on (ECS task definitions, Cloud Map URLs)
 */
export const AWS_CONTAINER_PORT = 8080;
