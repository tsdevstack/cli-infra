import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { getTerraformOutput, getTerraformOutputJson } = rs.hoisted(() => ({
  getTerraformOutput: rs.fn(),
  getTerraformOutputJson: rs.fn(),
}));

rs.mock('../terraform', () => ({
  getTerraformOutput,
  getTerraformOutputJson,
  toDnsAuthName: (domain: string) => domain.replace(/\./g, '-'),
}));

import { collectLoadBalancerDnsRecords } from './collect-load-balancer-dns-records';

describe('collectLoadBalancerDnsRecords', () => {
  const options = {
    terraformDir: '/tf/dev',
    tfEnv: {},
    apiDomain: 'api.example.com',
    frontendServices: [{ name: 'frontend', domain: 'example.com' }],
  };
  const auth = (name: string, data: string) => ({ name, data });

  beforeEach(() => {
    rs.resetAllMocks();
    getTerraformOutput.mockImplementation((_dir: string, name: string) => {
      if (name === 'load_balancer_ip') return '34.0.0.1';
      if (name === 'load_balancer_ipv6') return '2600:1901::';
      throw new Error(`no output ${name}`);
    });
    getTerraformOutputJson.mockImplementation((_dir: string, name: string) => {
      if (name === 'dns_auth_api_record')
        return auth('_acme-challenge.api.example.com.', 'a.authorize.goog.');
      if (name === 'dns_auth_frontend_record')
        return auth('_acme-challenge.example.com.', 'f.authorize.goog.');
      throw new Error(`no output ${name}`);
    });
  });

  describe('Standard use cases', () => {
    it('should list A and AAAA for every host and the certificate CNAMEs', () => {
      const { lbIp, records } = collectLoadBalancerDnsRecords(options);

      expect(lbIp).toBe('34.0.0.1');
      expect(records).toEqual([
        { type: 'A', host: 'api.example.com', value: '34.0.0.1' },
        { type: 'A', host: 'example.com', value: '34.0.0.1' },
        { type: 'AAAA', host: 'api.example.com', value: '2600:1901::' },
        { type: 'AAAA', host: 'example.com', value: '2600:1901::' },
        {
          type: 'CNAME',
          host: '_acme-challenge.api.example.com.',
          value: 'a.authorize.goog.',
        },
        {
          type: 'CNAME',
          host: '_acme-challenge.example.com.',
          value: 'f.authorize.goog.',
        },
      ]);
    });

    it('should add a redirect domain and its wildcard', () => {
      getTerraformOutputJson.mockImplementation(() => {
        throw new Error('no authorizations');
      });

      const { records } = collectLoadBalancerDnsRecords({
        ...options,
        redirectDomains: ['example.io'],
      });

      expect(records.filter((r) => r.type === 'A').map((r) => r.host)).toEqual([
        'api.example.com',
        'example.com',
        'example.io',
        '*.example.io',
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should skip AAAA for a state without an IPv6 address', () => {
      getTerraformOutput.mockImplementation((_dir: string, name: string) => {
        if (name === 'load_balancer_ip') return '34.0.0.1';
        throw new Error('no ipv6');
      });

      const { records } = collectLoadBalancerDnsRecords(options);

      expect(records.some((r) => r.type === 'AAAA')).toBe(false);
    });

    it('should skip CNAMEs for a state without DNS authorizations', () => {
      getTerraformOutputJson.mockImplementation(() => {
        throw new Error('no authorizations');
      });

      const { records } = collectLoadBalancerDnsRecords(options);

      expect(records.some((r) => r.type === 'CNAME')).toBe(false);
    });

    it('should throw when the state has no load balancer', () => {
      getTerraformOutput.mockImplementation(() => {
        throw new Error('no load balancer');
      });

      expect(() => collectLoadBalancerDnsRecords(options)).toThrow(
        'no load balancer',
      );
    });
  });
});
