import { describe, it, expect } from '@rstest/core';
import { formatAzureFrontDoorRow } from './format-azure-front-door-row';

describe('formatAzureFrontDoorRow', () => {
  describe('Standard use cases', () => {
    it('should describe a request with host, status and time', () => {
      expect(
        formatAzureFrontDoorRow({
          Category: 'FrontDoorAccessLog',
          httpMethod_s: 'GET',
          requestUri_s: 'https://api.example.com:443/auth/v1/me?x=1',
          httpStatusCode_s: '200',
          timeTaken_s: '0.012',
          errorInfo_s: 'NoError',
        }),
      ).toEqual({
        level: 'info',
        message: 'GET api.example.com/auth/v1/me?x=1 200 12ms',
      });
    });

    it('should describe a WAF block as a warning', () => {
      expect(
        formatAzureFrontDoorRow({
          Category: 'FrontDoorWebApplicationFirewallLog',
          action_s: 'Block',
          requestUri_s: 'https://api.example.com/auth/health?id=1',
          ruleName_s: 'Microsoft_DefaultRuleSet-2.1-SQLI-942100',
        }),
      ).toEqual({
        level: 'warn',
        message:
          'Block api.example.com/auth/health?id=1 by Microsoft_DefaultRuleSet-2.1-SQLI-942100',
      });
    });
  });

  describe('Edge cases', () => {
    it('should rate 4xx and 5xx and name the Front Door error', () => {
      expect(
        formatAzureFrontDoorRow({
          Category: 'FrontDoorAccessLog',
          httpMethod_s: 'GET',
          requestUri_s: 'https://api.example.com/x',
          httpStatusCode_d: 502,
          errorInfo_s: 'OriginConnectionError',
        }),
      ).toEqual({
        level: 'error',
        message: 'GET api.example.com/x 502 (OriginConnectionError)',
      });
      expect(
        formatAzureFrontDoorRow({
          Category: 'FrontDoorAccessLog',
          httpMethod_s: 'GET',
          requestUri_s: 'https://api.example.com/x',
          httpStatusCode_s: '404',
        }).level,
      ).toBe('warn');
    });

    it('should keep a URI it cannot parse and allow a missing rule', () => {
      expect(
        formatAzureFrontDoorRow({
          Category: 'FrontDoorWebApplicationFirewallLog',
          action_s: 'Log',
          requestUri_s: '/relative',
        }),
      ).toEqual({ level: 'info', message: 'Log /relative' });
    });
  });
});
