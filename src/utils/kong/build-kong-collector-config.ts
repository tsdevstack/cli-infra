/**
 * Config of Kong's collector sidecar
 */

import {
  KONG_COLLECTOR_HEALTH_PORT,
  KONG_COLLECTOR_MEMORY_CHECK_INTERVAL,
  KONG_COLLECTOR_MEMORY_LIMIT_MIB,
  KONG_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB,
  KONG_COLLECTOR_OTLP_ENDPOINT,
} from '../../constants';
import type { KongCollectorDestination } from './types';

/**
 * Receives Kong's spans over OTLP/HTTP on localhost, batches them and sends
 * them to the cloud's trace service (the destination: its auth extension,
 * resource attributes and exporter). memory_limiter runs first and keeps
 * the collector inside its memory. The health_check extension answers
 * Cloud Run's startup probe; the collector's own metrics are off.
 */
export function buildKongCollectorConfig(
  destination: KongCollectorDestination,
): Record<string, unknown> {
  return {
    receivers: {
      otlp: {
        protocols: {
          http: { endpoint: KONG_COLLECTOR_OTLP_ENDPOINT },
        },
      },
    },
    extensions: {
      health_check: { endpoint: `0.0.0.0:${KONG_COLLECTOR_HEALTH_PORT}` },
      ...destination.extensions,
    },
    processors: {
      memory_limiter: {
        check_interval: KONG_COLLECTOR_MEMORY_CHECK_INTERVAL,
        limit_mib: KONG_COLLECTOR_MEMORY_LIMIT_MIB,
        spike_limit_mib: KONG_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB,
      },
      ...destination.processors,
      batch: {},
    },
    exporters: destination.exporters,
    service: {
      extensions: ['health_check', ...Object.keys(destination.extensions)],
      pipelines: {
        traces: {
          receivers: ['otlp'],
          processors: [
            'memory_limiter',
            ...Object.keys(destination.processors),
            'batch',
          ],
          exporters: Object.keys(destination.exporters),
        },
      },
      telemetry: {
        logs: { level: 'warn' },
        metrics: { level: 'none' },
      },
    },
  };
}
