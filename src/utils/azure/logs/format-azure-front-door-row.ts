/**
 * Describe a Front Door log row (AzureDiagnostics) as an edge line:
 * - request: "GET api.example.com/auth/v1/me 200 12ms"
 * - WAF: "Block api.example.com/x?id=1 by DefaultRuleSet-1.0-SQLI-942100"
 * Requests answered with 5xx are errors, 4xx and WAF blocks warnings.
 */

import type { LogLevel } from '../../logs/types';

export function formatAzureFrontDoorRow(raw: Record<string, unknown>): {
  level: LogLevel;
  message: string;
} {
  const text = (key: string): string => {
    const value = raw[key];
    return value === undefined || value === null ? '' : String(value);
  };

  const target = (uri: string): string => {
    try {
      const url = new URL(uri);
      return `${url.host}${url.pathname}${url.search}`;
    } catch {
      return uri;
    }
  };

  if (text('Category') === 'FrontDoorWebApplicationFirewallLog') {
    const action = text('action_s') || 'Unknown';
    const rule = text('ruleName_s');
    return {
      level: /block/i.test(action) ? 'warn' : 'info',
      message: `${action} ${target(text('requestUri_s'))}${rule ? ` by ${rule}` : ''}`,
    };
  }

  const status = Number(text('httpStatusCode_s') || text('httpStatusCode_d'));
  const seconds = Number.parseFloat(text('timeTaken_s') || text('timeTaken_d'));
  const parts = [text('httpMethod_s'), target(text('requestUri_s'))];
  if (!Number.isNaN(status) && status > 0) {
    parts.push(String(status));
  }
  if (!Number.isNaN(seconds)) {
    parts.push(`${Math.round(seconds * 1000)}ms`);
  }
  const error = text('errorInfo_s');
  let message = parts.filter(Boolean).join(' ');
  if (error && error !== 'NoError') {
    message += ` (${error})`;
  }

  let level: LogLevel = 'info';
  if (status >= 500) {
    level = 'error';
  } else if (status >= 400) {
    level = 'warn';
  }

  return { level, message };
}
