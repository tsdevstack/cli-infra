import { describe, it, expect } from '@rstest/core';
import { parseAwsWafEvent } from './parse-aws-waf-event';

const TIME = Date.UTC(2026, 9, 30, 12, 0, 1, 123);

describe('parseAwsWafEvent', () => {
  const source = { name: 'edge', type: 'edge' as const };

  it('should describe an allowed request with its host', () => {
    const line = parseAwsWafEvent(
      {
        timestamp: TIME,
        message: JSON.stringify({
          action: 'ALLOW',
          terminatingRuleId: 'Default_Action',
          httpRequest: {
            httpMethod: 'GET',
            uri: '/auth/v1/me',
            args: '',
            headers: [{ name: 'Host', value: 'api.example.com' }],
          },
        }),
      },
      source,
    );
    expect(line).toMatchObject({
      kind: 'edge',
      level: 'info',
      message: 'GET api.example.com/auth/v1/me ALLOW',
    });
  });

  it('should name the rule group and the rule of a block', () => {
    const line = parseAwsWafEvent(
      {
        timestamp: TIME,
        message: JSON.stringify({
          action: 'BLOCK',
          terminatingRuleId: 'AWS-AWSManagedRulesSQLiRuleSet',
          ruleGroupList: [
            { terminatingRule: null },
            { terminatingRule: { ruleId: 'SQLi_QUERYARGUMENTS' } },
          ],
          httpRequest: {
            httpMethod: 'GET',
            uri: '/auth/health',
            args: "id=1'",
            headers: [{ name: 'host', value: 'api.example.com' }],
          },
        }),
      },
      source,
    );
    expect(line).toMatchObject({
      level: 'warn',
      message:
        "GET api.example.com/auth/health?id=1' BLOCK by AWS-AWSManagedRulesSQLiRuleSet (SQLi_QUERYARGUMENTS)",
    });
  });

  it('should show a record it cannot read as text', () => {
    expect(
      parseAwsWafEvent({ timestamp: TIME, message: 'not json' }, source),
    ).toMatchObject({
      kind: 'edge',
      message: 'not json',
    });
  });
});
