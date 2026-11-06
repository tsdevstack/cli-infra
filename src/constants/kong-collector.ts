/**
 * Kong's OpenTelemetry Collector sidecar (cloud)
 *
 * Kong's opentelemetry plugin can only send static headers, so it cannot
 * sign in to Cloud Trace, X-Ray or Application Insights. It sends its spans
 * to this collector next to it (localhost:4318), which signs and forwards
 * them. Built from the contrib distribution (Google auth, SigV4, Azure
 * auth) with the environment's config baked in, and pushed next to the
 * Kong image, so nothing is pulled from Docker Hub at runtime.
 */

/** Pinned contrib distribution: the collector's base image */
export const KONG_COLLECTOR_BASE_IMAGE =
  'otel/opentelemetry-collector-contrib:0.164.0';

/** Image name in the project's registry, next to `kong` */
export const KONG_COLLECTOR_IMAGE_NAME = 'kong-collector';

/** Container name of the sidecar in Kong's service, task or app */
export const KONG_COLLECTOR_CONTAINER_NAME = 'otel-collector';

/** Where the contrib image reads its config */
export const KONG_COLLECTOR_CONFIG_PATH = '/etc/otelcol-contrib/config.yaml';

/** OTLP/HTTP receiver: only Kong, in the same instance, sends to it */
export const KONG_COLLECTOR_OTLP_ENDPOINT = 'localhost:4318';

/** health_check extension port (Cloud Run startup probe) */
export const KONG_COLLECTOR_HEALTH_PORT = 13133;

/** Cloud Run: the sidecar's share next to Kong (instance total = Kong's + this) */
export const KONG_COLLECTOR_CLOUD_RUN_CPU = '0.25';
export const KONG_COLLECTOR_CLOUD_RUN_MEMORY = '256Mi';

/**
 * ECS: the sidecar's hard memory limit (MiB) inside Kong's task; it shares
 * the task's CPU with Kong
 */
export const KONG_COLLECTOR_ECS_MEMORY = 256;

/**
 * memory_limiter processor: above the soft limit (limit minus spike) the
 * collector frees memory, and above the limit it refuses Kong's spans, so
 * it stays inside its 256 MiB on every cloud
 */
export const KONG_COLLECTOR_MEMORY_LIMIT_MIB = 200;
export const KONG_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB = 50;
export const KONG_COLLECTOR_MEMORY_CHECK_INTERVAL = '1s';

/** Azure: Entra scope of Azure Monitor's OTLP endpoint (azure_auth) */
export const KONG_COLLECTOR_AZURE_MONITOR_SCOPE =
  'https://monitor.azure.com/.default';

/**
 * Azure: name of the main container (Kong) when Kong's app runs as App
 * Service site containers, with the collector as a sidecar
 */
export const KONG_AZURE_MAIN_CONTAINER_NAME = 'main';

/** Azure: the port Kong listens on in its App Service (WEBSITES_PORT) */
export const KONG_AZURE_PORT = 8080;
