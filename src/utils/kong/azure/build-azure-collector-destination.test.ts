import { describe, it, expect } from '@rstest/core';
import { buildAzureCollectorDestination } from './build-azure-collector-destination';

describe('buildAzureCollectorDestination', () => {
  describe('Standard use cases', () => {
    it("should send to the data collection rule's URL from the shared app setting", () => {
      expect(buildAzureCollectorDestination().exporters).toEqual({
        otlp_http: {
          traces_endpoint: '${env:OTEL_EXPORTER_OTLP_TRACES_ENDPOINT}',
          auth: { authenticator: 'azure_auth' },
        },
      });
    });

    it("should sign in with Kong's system-assigned identity for Azure Monitor", () => {
      expect(buildAzureCollectorDestination().extensions).toEqual({
        azure_auth: {
          managed_identity: {},
          scopes: ['https://monitor.azure.com/.default'],
        },
      });
    });
  });

  describe('Edge cases', () => {
    it('should mark the spans as Azure', () => {
      expect(buildAzureCollectorDestination().processors).toEqual({
        resource: {
          attributes: [
            { key: 'cloud.provider', value: 'azure', action: 'upsert' },
          ],
        },
      });
    });
  });
});
