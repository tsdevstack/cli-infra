import { describe, it, expect } from '@rstest/core';
import { createWakeupPostFunction } from './create-wakeup-post-function';

describe('createWakeupPostFunction', () => {
  it('should create post-function plugin', () => {
    const plugin = createWakeupPostFunction();
    expect(plugin.name).toBe('post-function');
  });

  it('should configure header_filter phase', () => {
    const plugin = createWakeupPostFunction();
    const config = plugin.config as { header_filter: string[] };
    expect(config.header_filter).toBeDefined();
    expect(config.header_filter).toHaveLength(1);
  });

  it('should check for 502/503 status codes', () => {
    const plugin = createWakeupPostFunction();
    const config = plugin.config as { header_filter: string[] };
    expect(config.header_filter[0]).toContain('kong.response.get_status()');
    expect(config.header_filter[0]).toContain('status == 502 or status == 503');
  });

  it('should use WAKEUP_LAMBDA_URL placeholder (resolved at build time)', () => {
    const plugin = createWakeupPostFunction();
    const config = plugin.config as { header_filter: string[] };
    expect(config.header_filter[0]).toContain('${WAKEUP_LAMBDA_URL}');
  });

  it('should fire async HTTP call with ngx.timer.at', () => {
    const plugin = createWakeupPostFunction();
    const config = plugin.config as { header_filter: string[] };
    expect(config.header_filter[0]).toContain('ngx.timer.at(0,');
  });

  it('should use resty.http for HTTP requests', () => {
    const plugin = createWakeupPostFunction();
    const config = plugin.config as { header_filter: string[] };
    expect(config.header_filter[0]).toContain('require("resty.http")');
  });

  it('should return 503 with Retry-After header', () => {
    const plugin = createWakeupPostFunction();
    const config = plugin.config as { header_filter: string[] };
    expect(config.header_filter[0]).toContain('kong.response.exit(503');
    expect(config.header_filter[0]).toContain('["Retry-After"] = "30"');
  });

  it('should skip OPTIONS requests for CORS preflight', () => {
    const plugin = createWakeupPostFunction();
    const config = plugin.config as { header_filter: string[] };
    expect(config.header_filter[0]).toContain('kong.request.get_method()');
    expect(config.header_filter[0]).toContain('method == "OPTIONS"');
  });

  it('should include CORS headers in 503 response', () => {
    const plugin = createWakeupPostFunction();
    const config = plugin.config as { header_filter: string[] };
    expect(config.header_filter[0]).toContain(
      '["Access-Control-Allow-Origin"]',
    );
    expect(config.header_filter[0]).toContain(
      '["Access-Control-Allow-Credentials"]',
    );
  });
});
