/**
 * Has Any Resources
 *
 * Check if any cloud resources were discovered for a service.
 */

import type { DiscoveredResources } from '../discovery';

/**
 * Check if any resources were discovered
 */
export function hasAnyResources(discovered: DiscoveredResources): boolean {
  return (
    discovered.cloudRunService ||
    discovered.spaBucket ||
    discovered.secrets.length > 0 ||
    discovered.database ||
    discovered.serviceAccount
  );
}
