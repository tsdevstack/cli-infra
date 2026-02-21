/**
 * Check if any resources exist for a service
 *
 * Returns true if discovered resources contain anything that needs deletion.
 */

import type { DiscoveredResources } from '../discovery';

export function hasAnyResources(discovered: DiscoveredResources): boolean {
  return (
    discovered.containerApp ||
    discovered.spaBucket ||
    discovered.secrets.length > 0
  );
}
