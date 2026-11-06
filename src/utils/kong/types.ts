/**
 * Types for cloud Kong generation
 */

/**
 * Where Kong's collector sidecar sends spans: the cloud-specific part of
 * its config (component names as the collector's config uses them)
 */
export interface KongCollectorDestination {
  extensions: Record<string, unknown>;
  processors: Record<string, unknown>;
  exporters: Record<string, unknown>;
}
