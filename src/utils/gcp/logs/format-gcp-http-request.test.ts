import { describe, it, expect } from '@rstest/core';
import { formatGcpHttpRequest } from './format-gcp-http-request';

describe('formatGcpHttpRequest', () => {
  describe('Standard use cases', () => {
    it('should show method, path with query, status and latency', () => {
      expect(
        formatGcpHttpRequest({
          requestMethod: 'GET',
          requestUrl: 'https://api.example.com/auth/v1/me?x=1',
          status: 200,
          latency: '0.012345s',
        }),
      ).toBe('GET /auth/v1/me?x=1 200 12ms');
    });
  });

  describe('With the host', () => {
    it('should put the host before the path', () => {
      expect(
        formatGcpHttpRequest(
          {
            requestMethod: 'GET',
            requestUrl: 'https://api.example.com/auth/v1/me',
            status: 200,
          },
          { includeHost: true },
        ),
      ).toBe('GET api.example.com/auth/v1/me 200');
    });
  });

  describe('Edge cases', () => {
    it('should leave out missing parts', () => {
      expect(formatGcpHttpRequest({ status: 500 })).toBe('500');
      expect(formatGcpHttpRequest({})).toBe('');
    });

    it('should keep a URL it cannot parse as it is', () => {
      expect(
        formatGcpHttpRequest({ requestMethod: 'GET', requestUrl: '/health' }),
      ).toBe('GET /health');
    });
  });
});
