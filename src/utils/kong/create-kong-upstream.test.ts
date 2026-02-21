import { describe, it, expect } from '@rstest/core';
import { createKongUpstream } from './create-kong-upstream';

describe('createKongUpstream', () => {
  it('should create upstream with ALB target', () => {
    const upstream = createKongUpstream({
      serviceName: 'auth-service',
    });

    expect(upstream.name).toBe('auth-service-upstream');
    expect(upstream.algorithm).toBe('round-robin');
    expect(upstream.host_header).toBe('auth-service.internal');
    expect(upstream.targets).toHaveLength(1);
    expect(upstream.targets[0].target).toBe('${ALB_INTERNAL_DNS}:8443');
    expect(upstream.targets[0].weight).toBe(1000);
  });

  it('should set host_header for ALB host-based routing', () => {
    const upstream = createKongUpstream({
      serviceName: 'bff-service',
    });

    expect(upstream.host_header).toBe('bff-service.internal');
  });

  it('should configure HTTPS health checks', () => {
    const upstream = createKongUpstream({
      serviceName: 'auth-service',
    });

    expect(upstream.healthchecks.active.type).toBe('https');
    expect(upstream.healthchecks.active.http_path).toBe('/health');
    expect(upstream.healthchecks.active.https_verify_certificate).toBe(false);
    expect(upstream.healthchecks.active.healthy.interval).toBe(5);
    expect(upstream.healthchecks.passive.unhealthy.http_statuses).toEqual([
      500, 502, 503, 504,
    ]);
  });

  it('should include Host header in health checks for ALB routing', () => {
    const upstream = createKongUpstream({
      serviceName: 'auth-service',
    });

    expect(upstream.healthchecks.active.headers).toEqual({
      Host: ['auth-service.internal'],
    });
  });
});
