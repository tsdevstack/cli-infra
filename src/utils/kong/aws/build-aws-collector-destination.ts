/**
 * Where Kong's collector sends spans on AWS
 */

import type { KongCollectorDestination } from '../types';

/**
 * X-Ray's OTLP endpoint, signed with the task role (sigv4auth, ECS container
 * credentials). The log group lets X-Ray find Kong's log lines for a trace.
 */
export function buildAwsCollectorDestination(params: {
  region: string;
  logGroup: string;
}): KongCollectorDestination {
  return {
    extensions: {
      sigv4auth: { region: params.region, service: 'xray' },
    },
    processors: {
      resource: {
        attributes: [
          {
            key: 'aws.log.group.names',
            value: params.logGroup,
            action: 'upsert',
          },
          { key: 'cloud.provider', value: 'aws', action: 'upsert' },
          { key: 'cloud.region', value: params.region, action: 'upsert' },
        ],
      },
    },
    exporters: {
      otlp_http: {
        traces_endpoint: `https://xray.${params.region}.amazonaws.com/v1/traces`,
        auth: { authenticator: 'sigv4auth' },
      },
    },
  };
}
