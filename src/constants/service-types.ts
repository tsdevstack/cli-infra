/**
 * Service type constants
 */

/**
 * Service types that can be deployed as containers
 */
export const DEPLOYABLE_SERVICE_TYPES = ['nestjs', 'nextjs'] as const;

export type DeployableServiceType = (typeof DEPLOYABLE_SERVICE_TYPES)[number];