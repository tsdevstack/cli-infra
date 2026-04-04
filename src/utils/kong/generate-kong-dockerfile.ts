/**
 * Generate Kong Dockerfile content for cloud deployment
 *
 * Includes OIDC plugin installation (same approach as infrastructure/kong/Dockerfile)
 */

import type { CloudProvider } from '@tsdevstack/cli/plugin';

interface GenerateKongDockerfileOptions {
  provider?: CloudProvider;
  /** Max upload size for traditional file uploads (nginx client_max_body_size). Default: "10m" */
  maxUploadSize?: string;
}

/**
 * Returns the Dockerfile content for Kong Gateway
 */
export function generateKongDockerfile(
  options?: GenerateKongDockerfileOptions,
): string {
  const healthCheckScript =
    options?.provider === 'aws'
      ? buildAwsHealthCheckScript()
      : buildBasicHealthCheckScript();

  const maxUploadSize = options?.maxUploadSize ?? '10m';

  return `FROM kong:3.8

# Switch to root to install plugins and configure
USER root

# Install dependencies for plugin installation and health checks
RUN apt-get update && apt-get install -y git unzip curl && rm -rf /var/lib/apt/lists/*

# Install lua-resty-openidc dependency manually (luarocks has manifest size issues)
RUN git clone --depth 1 --branch v1.7.6 https://github.com/zmartzone/lua-resty-openidc.git /tmp/lua-resty-openidc && \\
    cd /tmp/lua-resty-openidc && \\
    cp -r lib/resty/* /usr/local/share/lua/5.1/resty/ && \\
    rm -rf /tmp/lua-resty-openidc

# Install kong-oidc-v3 plugin manually
RUN git clone --depth 1 https://github.com/Gate1106/kong-oidc-v3.git /tmp/kong-oidc-v3 && \\
    mkdir -p /usr/local/share/lua/5.1/kong/plugins/oidc && \\
    cp -r /tmp/kong-oidc-v3/kong/plugins/oidc/* /usr/local/share/lua/5.1/kong/plugins/oidc/ && \\
    rm -rf /tmp/kong-oidc-v3

# Enable the oidc plugin
ENV KONG_PLUGINS=bundled,oidc

# Database-less mode
ENV KONG_DATABASE=off
ENV KONG_DECLARATIVE_CONFIG=/kong/declarative/kong.yml

# Proxy port (all providers use 8080)
ENV KONG_PROXY_LISTEN="0.0.0.0:8080"

# Admin API DISABLED for security (critical!)
ENV KONG_ADMIN_LISTEN="off"

# Status API for health checks (internal port)
ENV KONG_STATUS_LISTEN="0.0.0.0:8100"

# Logging
ENV KONG_PROXY_ACCESS_LOG=/dev/stdout
ENV KONG_PROXY_ERROR_LOG=/dev/stderr
ENV KONG_LOG_LEVEL=notice

# Memory configuration (production tuning)
ENV KONG_MEM_CACHE_SIZE=256m
ENV KONG_LMDB_MAP_SIZE=2048m

# Faster cold starts
ENV KONG_DB_CACHE_WARMUP_ENTITIES=services
ENV KONG_NGINX_WORKER_PROCESSES=2

# Max upload size for traditional file uploads (default: 10m)
ENV KONG_NGINX_HTTP_CLIENT_MAX_BODY_SIZE=${maxUploadSize}

# Client IP detection behind Load Balancer
ENV KONG_TRUSTED_IPS="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
ENV KONG_REAL_IP_HEADER="X-Forwarded-For"
ENV KONG_REAL_IP_RECURSIVE="on"

# Container port
EXPOSE 8080
EXPOSE 8100

# Graceful shutdown (Kong uses SIGQUIT, not SIGTERM!)
STOPSIGNAL SIGQUIT

# Create declarative config directory
RUN mkdir -p /kong/declarative && chown kong:kong /kong/declarative

# Copy baked-in configuration
COPY kong.yml /kong/declarative/kong.yml
RUN chown kong:kong /kong/declarative/kong.yml

${healthCheckScript}
# Switch back to kong user for runtime
USER kong
CMD ["kong", "docker-start"]
`;
}

/**
 * AWS health check script with OIDC validation and wakeup lambda
 *
 * 1. Wait for /status/ready (Kong 3.3+ - config loaded, ready to proxy)
 * 2. On first check: validate OIDC discovery works (wake auth-service if needed)
 * 3. After first success: skip OIDC check (prevents auth-service flicker)
 * Uses WAKEUP_LAMBDA_URL and WAKEUP_SECRET env vars (injected by ECS)
 */
function buildAwsHealthCheckScript(): string {
  return `# Health check script with OIDC validation and wakeup lambda (AWS)
RUN echo '#!/bin/sh' > /usr/local/bin/kong-health-check.sh && \\
    echo 'curl -sf http://localhost:8100/status/ready || exit 1' >> /usr/local/bin/kong-health-check.sh && \\
    echo '# After first successful OIDC check, skip validation' >> /usr/local/bin/kong-health-check.sh && \\
    echo 'if [ -f /tmp/oidc-initialized ]; then exit 0; fi' >> /usr/local/bin/kong-health-check.sh && \\
    echo '# Check if OIDC already works' >> /usr/local/bin/kong-health-check.sh && \\
    echo 'if curl -sf http://localhost:8080/auth/.well-known/openid-configuration > /dev/null 2>&1; then' >> /usr/local/bin/kong-health-check.sh && \\
    echo '  touch /tmp/oidc-initialized && exit 0' >> /usr/local/bin/kong-health-check.sh && \\
    echo 'fi' >> /usr/local/bin/kong-health-check.sh && \\
    echo '# OIDC failed, wake up auth-service and poll' >> /usr/local/bin/kong-health-check.sh && \\
    echo 'curl -sf -X POST "$WAKEUP_LAMBDA_URL" -H "Content-Type: application/json" -H "X-Wake-Secret: $WAKEUP_SECRET" -d '"'"'{"services":["auth-service"]}'"'"' > /dev/null 2>&1 || true' >> /usr/local/bin/kong-health-check.sh && \\
    echo 'for i in $(seq 1 25); do' >> /usr/local/bin/kong-health-check.sh && \\
    echo '  if curl -sf http://localhost:8080/auth/.well-known/openid-configuration > /dev/null 2>&1; then' >> /usr/local/bin/kong-health-check.sh && \\
    echo '    touch /tmp/oidc-initialized && exit 0' >> /usr/local/bin/kong-health-check.sh && \\
    echo '  fi' >> /usr/local/bin/kong-health-check.sh && \\
    echo '  sleep 2' >> /usr/local/bin/kong-health-check.sh && \\
    echo 'done' >> /usr/local/bin/kong-health-check.sh && \\
    echo 'exit 1' >> /usr/local/bin/kong-health-check.sh && \\
    chmod +x /usr/local/bin/kong-health-check.sh
`;
}

/**
 * Basic health check script — checks Kong readiness only
 */
function buildBasicHealthCheckScript(): string {
  return `# Health check script
RUN echo '#!/bin/sh' > /usr/local/bin/kong-health-check.sh && \\
    echo 'curl -sf http://localhost:8100/status/ready || exit 1' >> /usr/local/bin/kong-health-check.sh && \\
    chmod +x /usr/local/bin/kong-health-check.sh
`;
}
