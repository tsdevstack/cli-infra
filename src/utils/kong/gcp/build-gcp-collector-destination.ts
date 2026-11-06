/**
 * Where Kong's collector sends spans on GCP
 */

import type { KongCollectorDestination } from '../types';

/**
 * Cloud Trace through Google's OTLP endpoint, with a token of Kong's service
 * account (google_client_auth, from Cloud Run's metadata server). Google
 * rejects spans without gcp.project_id.
 */
export function buildGcpCollectorDestination(
  projectId: string,
): KongCollectorDestination {
  return {
    extensions: { google_client_auth: {} },
    processors: {
      resource: {
        attributes: [
          { key: 'gcp.project_id', value: projectId, action: 'upsert' },
          { key: 'cloud.provider', value: 'gcp', action: 'upsert' },
        ],
      },
    },
    exporters: {
      otlp_http: {
        traces_endpoint: 'https://telemetry.googleapis.com/v1/traces',
        auth: { authenticator: 'google_client_auth' },
      },
    },
  };
}
