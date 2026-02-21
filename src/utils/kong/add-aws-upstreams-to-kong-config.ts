/**
 * Transform Kong config for AWS deployment
 *
 * AWS ECS services route through ALB with host-header routing.
 * This function wraps service URLs in upstreams that target ALB.
 *
 * Scale-to-zero wake-up is handled by post-function plugin:
 * 1. ALB returns 502/503 (no healthy targets)
 * 2. post-function intercepts response
 * 3. Fires async HTTP call to wake-up Lambda
 * 4. Returns 503 with Retry-After to client
 *
 * OIDC Discovery: Uses Kong's own proxy (127.0.0.1:8080) for self-routing.
 * Kong OIDC plugin calls 127.0.0.1:8080, Kong routes via auth-service-public,
 * which uses auth-service-upstream. This enables wake-up for OIDC discovery
 * without external DNS resolution.
 * Note: Use 127.0.0.1 (not localhost) as Lua DNS resolver doesn't use /etc/hosts.
 *
 * GCP doesn't need this - Cloud Run has built-in wake-up.
 *
 * See: docs/in-dev/phase-21-aws-service-discovery-fix.md
 */

import type {
  KongTemplate,
  KongUpstream,
  KongService,
} from '@tsdevstack/cli/plugin';
import { fromServiceEnvVarName } from '@tsdevstack/infra-core';
import { createKongUpstream } from './create-kong-upstream';
import { createWakeupPostFunction } from './create-wakeup-post-function';

interface AddAwsUpstreamsOptions {
  projectName: string;
}

/**
 * Create OIDC discovery service that preserves original Host header.
 * This connects directly to ALB (not through upstream) so auth-service
 * receives Host: 127.0.0.1:8080 and returns correct jwks_uri.
 *
 * Uses HTTP (not HTTPS) on port 8080 so ALB sets:
 * - X-Forwarded-Proto: http
 * - X-Forwarded-Port: 8080
 *
 * Auth-service uses these X-Forwarded headers to construct jwks_uri,
 * so it returns http://127.0.0.1:8080/... which Kong can reach via its own proxy.
 *
 * Requires ALB HTTP listener on port 8080 with path-based rule for
 * /auth/.well-known/* → auth-service target group.
 *
 * See: docs/in-dev/phase-21-aws-service-discovery-fix.md (Phase 21.11c)
 */
function createOidcDiscoveryService(): KongService {
  return {
    name: 'oidc-discovery',
    // HTTP listener on port 8080 - NOT HTTPS
    // This ensures ALB sets X-Forwarded-Proto: http, X-Forwarded-Port: 8080
    // So auth-service returns jwks_uri that Kong can reach via its own proxy
    url: 'http://${ALB_INTERNAL_DNS}:8080',
    routes: [
      {
        name: 'oidc-discovery-route',
        paths: [
          '/auth/.well-known/jwks.json',
          '/auth/.well-known/openid-configuration',
        ],
        strip_path: false,
        // Preserve original Host header (127.0.0.1:8080) so auth-service
        // returns jwks_uri that Kong can resolve
        preserve_host: true,
      },
    ],
  };
}

/**
 * Create a health check service for ALB health checks.
 * Uses request-termination plugin to return 200 without needing an upstream.
 */
function createHealthService(): KongService {
  return {
    name: 'health-check',
    url: 'http://localhost:65535', // Dummy URL - request-termination intercepts
    routes: [
      {
        name: 'health-route',
        paths: ['/health'],
        strip_path: false,
      },
    ],
    plugins: [
      {
        name: 'request-termination',
        config: {
          status_code: 200,
          content_type: 'application/json',
          body: '{"status":"ok"}',
        },
      },
    ],
  };
}

export function addAwsUpstreamsToKongConfig(
  config: KongTemplate,
  _options: AddAwsUpstreamsOptions,
): KongTemplate {
  const upstreamsMap = new Map<string, KongUpstream>();

  const transformedServices = config.services.map((service) => {
    // Extract service name from placeholder: ${AUTH_SERVICE_URL} -> auth-service
    const match = service.url.match(/\$\{(\w+)_URL\}/);
    if (!match) {
      return service;
    }

    const envVarPrefix = match[1]; // AUTH_SERVICE
    const serviceName = fromServiceEnvVarName(envVarPrefix); // auth-service

    if (!upstreamsMap.has(serviceName)) {
      const upstream = createKongUpstream({ serviceName });
      upstreamsMap.set(serviceName, upstream);
    }

    // Transform URL: ${AUTH_SERVICE_URL}/path -> https://auth-service-upstream/path
    // HTTPS required for mixed targets: ALB:8443 (HTTPS) and Lambda:443 (HTTPS)
    const upstreamName = `${serviceName}-upstream`;
    const urlParts = service.url.split(/\$\{[^}]+\}/);
    const pathSuffix = urlParts[1] || '';
    const newUrl = `https://${upstreamName}${pathSuffix}`;

    // Transform OIDC discovery URLs to use Kong's own proxy port (127.0.0.1:8080)
    // This routes discovery through Kong itself, using auth-service-public route
    // which proxies to auth-service-upstream with failover for wake-up
    const transformedPlugins = service.plugins?.map((plugin) => {
      if (plugin.name === 'oidc' && plugin.config?.discovery) {
        const discovery = plugin.config.discovery as string;
        // Replace ${AUTH_SERVICE_URL}/path with http://127.0.0.1:8080/path
        // Kong's OIDC plugin calls 127.0.0.1:8080 → Kong routes to auth-service-upstream
        // Auth-service returns jwks_uri with 127.0.0.1:8080 host → Kong resolves it
        // Note: Kong listens on port 8080 (KONG_PROXY_LISTEN), use IP not hostname
        const transformedDiscovery = discovery.replace(
          /\$\{[A-Z_]+_URL\}/,
          'http://127.0.0.1:8080',
        );
        return {
          ...plugin,
          config: {
            ...plugin.config,
            discovery: transformedDiscovery,
            // No ssl_verify needed - localhost HTTP doesn't use SSL
          },
        };
      }
      return plugin;
    });

    return {
      ...service,
      url: newUrl,
      ...(transformedPlugins && { plugins: transformedPlugins }),
    };
  });

  // Add health service for ALB health checks (AWS-specific)
  const healthService = createHealthService();

  // Add OIDC discovery service with preserve_host for correct jwks_uri
  const oidcDiscoveryService = createOidcDiscoveryService();

  // Filter out OIDC discovery paths from auth-service-public (handled by oidc-discovery service)
  const filteredServices = transformedServices.map((service) => {
    if (service.name === 'auth-service-public') {
      return {
        ...service,
        routes: service.routes.map((route) => ({
          ...route,
          paths: route.paths?.filter(
            (p) =>
              p !== '/auth/.well-known/jwks.json' &&
              p !== '/auth/.well-known/openid-configuration',
          ),
        })),
      };
    }
    return service;
  });

  // Add global wake-up plugin for scale-to-zero support
  const wakeupPlugin = createWakeupPostFunction();
  const existingPlugins = config.plugins || [];

  return {
    ...config,
    services: [healthService, oidcDiscoveryService, ...filteredServices],
    upstreams: Array.from(upstreamsMap.values()),
    plugins: [...existingPlugins, wakeupPlugin],
  };
}
