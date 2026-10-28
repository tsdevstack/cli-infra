/**
 * Services that get their own runtime service account on GCP
 */

import type { FrameworkService } from '@tsdevstack/cli/plugin';

/**
 * The services that run as their own identity: backend services and Next.js
 * apps. A worker runs as its base service's account, so it reads that
 * service's secrets; an SPA is served from storage and has no runtime.
 *
 * @param services - Services from .tsdevstack/config.json
 * @returns One entry per service that gets a runtime service account
 */
export function listRuntimeAccountServices(
  services: readonly FrameworkService[],
): Array<{ name: string }> {
  return services
    .filter((s) => s.type !== 'worker' && s.type !== 'spa')
    .map((s) => ({ name: s.name }));
}
