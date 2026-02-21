/**
 * Get GCS multi-region location from a GCP region
 *
 * For terraform state buckets, multi-region locations (US, EU, ASIA)
 * are recommended for durability. This function maps GCP regions
 * to the appropriate multi-region location.
 */
export function getGcsLocationFromRegion(region: string): string {
  const lowerRegion = region.toLowerCase();

  if (
    lowerRegion.startsWith('us-') ||
    lowerRegion.startsWith('northamerica-')
  ) {
    return 'US';
  }

  if (lowerRegion.startsWith('europe-')) {
    return 'EU';
  }

  if (
    lowerRegion.startsWith('asia-') ||
    lowerRegion.startsWith('australia-') ||
    lowerRegion.startsWith('me-')
  ) {
    return 'ASIA';
  }

  // Default to US for unknown regions
  return 'US';
}
