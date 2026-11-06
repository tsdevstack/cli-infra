/**
 * Where Kong's collector sends spans on Azure
 */

import { KONG_COLLECTOR_AZURE_MONITOR_SCOPE } from '../../../constants';
import type { KongCollectorDestination } from '../types';

/**
 * Azure Monitor's OTLP endpoint (the environment's data collection rule),
 * signed in with an Entra token of Kong's system-assigned identity
 * (azure_auth with an empty managed_identity; the identity has the
 * publisher role on the rule). The rule's URL comes from the app setting
 * OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, which every container of Kong's app
 * shares, so the image doesn't depend on Terraform's outputs.
 */
export function buildAzureCollectorDestination(): KongCollectorDestination {
  return {
    extensions: {
      azure_auth: {
        managed_identity: {},
        scopes: [KONG_COLLECTOR_AZURE_MONITOR_SCOPE],
      },
    },
    processors: {
      resource: {
        attributes: [
          { key: 'cloud.provider', value: 'azure', action: 'upsert' },
        ],
      },
    },
    exporters: {
      otlp_http: {
        traces_endpoint: '${env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT}',
        auth: { authenticator: 'azure_auth' },
      },
    },
  };
}
