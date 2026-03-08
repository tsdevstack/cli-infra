import { describe, it, expect } from '@rstest/core';
import { generateKongDockerfile } from './generate-kong-dockerfile';

describe('generateKongDockerfile', () => {
  it('should return a string', () => {
    const result = generateKongDockerfile();
    expect(typeof result).toBe('string');
  });

  it('should start with FROM kong base image', () => {
    const result = generateKongDockerfile();
    expect(result).toMatch(/^FROM kong:\d+\.\d+/);
  });

  it('should include OIDC plugin installation', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('kong-oidc');
    expect(result).toContain('lua-resty-openidc');
  });

  it('should enable OIDC plugin', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('KONG_PLUGINS=bundled,oidc');
  });

  it('should configure database-less mode', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('KONG_DATABASE=off');
    expect(result).toContain('KONG_DECLARATIVE_CONFIG');
  });

  it('should configure proxy on port 8080', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('KONG_PROXY_LISTEN="0.0.0.0:8080"');
    expect(result).toContain('EXPOSE 8080');
  });

  it('should disable admin API for security', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('KONG_ADMIN_LISTEN="off"');
  });

  it('should configure status endpoint for health checks', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('KONG_STATUS_LISTEN');
    expect(result).toContain('8100');
  });

  it('should configure logging to stdout/stderr', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('KONG_PROXY_ACCESS_LOG=/dev/stdout');
    expect(result).toContain('KONG_PROXY_ERROR_LOG=/dev/stderr');
  });

  it('should use SIGQUIT for graceful shutdown', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('STOPSIGNAL SIGQUIT');
  });

  it('should configure trusted IPs for load balancer', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('KONG_TRUSTED_IPS');
    expect(result).toContain('KONG_REAL_IP_HEADER');
  });

  it('should copy kong.yml configuration', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('COPY kong.yml /kong/declarative/kong.yml');
  });

  it('should switch to kong user for runtime', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('USER kong');
    expect(result).toContain('CMD ["kong", "docker-start"]');
  });

  it('should include basic health check for all providers', () => {
    const result = generateKongDockerfile();
    expect(result).toContain('kong-health-check.sh');
    expect(result).toContain('localhost:8100/status/ready');
  });

  it('should include AWS health check script when provider is aws', () => {
    const result = generateKongDockerfile({ provider: 'aws' });
    expect(result).toContain('WAKEUP_LAMBDA_URL');
    expect(result).toContain('WAKEUP_SECRET');
    expect(result).toContain('oidc-initialized');
  });

  it('should not include AWS health check script for non-aws providers', () => {
    const gcpResult = generateKongDockerfile({ provider: 'gcp' });
    expect(gcpResult).not.toContain('WAKEUP_LAMBDA_URL');
    expect(gcpResult).not.toContain('WAKEUP_SECRET');

    const azureResult = generateKongDockerfile({ provider: 'azure' });
    expect(azureResult).not.toContain('WAKEUP_LAMBDA_URL');
    expect(azureResult).not.toContain('WAKEUP_SECRET');
  });
});
