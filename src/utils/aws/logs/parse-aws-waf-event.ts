/**
 * Turn a WAF record (CloudFront scope) into an edge line:
 * "GET api.example.com/auth/v1/me ALLOW", or for a block
 * "GET api.example.com/x?id=1 BLOCK by AWS-AWSManagedRulesSQLiRuleSet (SQLi_QUERYARGUMENTS)".
 * WAF records carry no response status.
 */

import type { FilteredLogEvent } from '@aws-sdk/client-cloudwatch-logs';
import type { LogEntry, LogSource } from '../../logs/types';

interface WafRecord {
  action?: string;
  terminatingRuleId?: string;
  ruleGroupList?: Array<{ terminatingRule?: { ruleId?: string } | null }>;
  httpRequest?: {
    httpMethod?: string;
    uri?: string;
    args?: string;
    headers?: Array<{ name?: string; value?: string }>;
  };
}

export function parseAwsWafEvent(
  event: FilteredLogEvent,
  source: LogSource,
): LogEntry {
  const time = new Date(event.timestamp ?? 0).toISOString();
  const text = event.message ?? '';

  let record: WafRecord;
  try {
    record = JSON.parse(text) as WafRecord;
  } catch {
    return {
      time,
      source: source.name,
      kind: 'edge',
      message: text,
      raw: event,
    };
  }

  const request = record.httpRequest ?? {};
  const host =
    request.headers?.find((header) => header.name?.toLowerCase() === 'host')
      ?.value ?? '';
  const query = request.args ? `?${request.args}` : '';
  const action = record.action ?? 'UNKNOWN';

  let message = `${request.httpMethod ?? ''} ${host}${request.uri ?? ''}${query} ${action}`;
  if (action !== 'ALLOW' && record.terminatingRuleId) {
    const rule = record.ruleGroupList?.find((group) => group.terminatingRule)
      ?.terminatingRule?.ruleId;
    message += ` by ${record.terminatingRuleId}${rule ? ` (${rule})` : ''}`;
  }

  return {
    time,
    source: source.name,
    kind: 'edge',
    level: action === 'ALLOW' ? 'info' : 'warn',
    message: message.trim(),
    raw: event,
  };
}
