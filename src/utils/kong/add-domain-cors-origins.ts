/**
 * Add the environment's domains to Kong's CORS origins
 *
 * KONG_CORS_ORIGINS is a secret derived from the domains when it is first
 * pushed, and pushes never overwrite it. A domain added to infrastructure.json
 * later, or an environment whose block didn't exist yet at that push, would
 * be missing, and the browser blocks that site's API calls. The build adds
 * `https://{domain}` for every domain in the environment's config and keeps
 * whatever the secret holds (origins a user added by hand). `*` already
 * allows every origin and is left alone.
 *
 * @returns the origins it added
 */

import type { KongTemplate } from '@tsdevstack/cli/plugin';

export function addDomainCorsOrigins(
  config: KongTemplate,
  domains: string[],
): string[] {
  const corsPlugin = config.plugins?.find((p) => p.name === 'cors');
  if (!corsPlugin) {
    return [];
  }

  const origins = corsPlugin.config.origins;
  const current = Array.isArray(origins)
    ? origins
    : typeof origins === 'string' && origins !== ''
      ? [origins]
      : [];
  if (current.includes('*')) {
    return [];
  }

  const added = [
    ...new Set(domains.map((domain) => `https://${domain}`)),
  ].filter((origin) => !current.includes(origin));

  corsPlugin.config.origins = [...current, ...added];
  return added;
}
