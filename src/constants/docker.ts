/**
 * Docker Constants
 */

/** Base image of the generated NestJS and Next.js Dockerfiles */
export const DOCKER_NODE_BASE_IMAGE = 'node:24-slim';

/**
 * Folders the CLI writes during generate and deploy. Changes there don't
 * count as uncommitted work when deciding whether to warn about the image tag.
 */
export const IMAGE_TAG_IGNORED_PATHS = [
  'infrastructure',
  '.tsdevstack',
] as const;
