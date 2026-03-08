/**
 * Format service resources for display
 *
 * Converts a resources object into a human-readable string
 * for use in infra:list-deployed output.
 */

export interface ServiceResources {
  cloudRunService?: boolean;
  spaBucket: boolean;
  hasDatabase?: boolean;
  secretCount?: number;
  hasServiceAccount?: boolean;
}

/**
 * Format resources into readable comma-separated string
 */
export function formatResources(resources: ServiceResources): string {
  const parts: string[] = [];

  if (resources.cloudRunService) {
    parts.push('Cloud Run');
  }
  if (resources.spaBucket) {
    parts.push('SPA Bucket');
  }
  if (resources.hasDatabase) {
    parts.push('Database');
  }
  if ((resources.secretCount ?? 0) > 0) {
    parts.push(`Secrets(${resources.secretCount})`);
  }
  if (resources.hasServiceAccount) {
    parts.push('IAM');
  }

  return parts.length > 0 ? parts.join(', ') : 'none';
}
