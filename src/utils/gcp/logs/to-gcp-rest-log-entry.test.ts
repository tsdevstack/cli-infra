import { describe, it, expect } from '@rstest/core';
import { Entry } from '@google-cloud/logging';
import { toGcpRestLogEntry } from './to-gcp-rest-log-entry';

type ApiEntry = Parameters<typeof Entry.fromApiResponse_>[0];

/**
 * Tail stream entries as gax decodes them (longs and enums as text,
 * defaults filled in, the oneof's name in `payload`), from encoding and
 * decoding real LogEntry messages with Cloud Logging's protos. Each goes
 * through the SDK's own Entry.fromApiResponse_, as tailEntries does.
 */
function decoded(fields: Record<string, unknown>): Entry {
  return Entry.fromApiResponse_({
    labels: {},
    insertId: '',
    httpRequest: null,
    resource: null,
    timestamp: null,
    severity: 'DEFAULT',
    logName: '',
    operation: null,
    trace: '',
    sourceLocation: null,
    receiveTimestamp: null,
    spanId: '',
    traceSampled: false,
    split: null,
    ...fields,
  } as unknown as ApiEntry);
}

describe('toGcpRestLogEntry', () => {
  describe('Standard use cases', () => {
    it('should turn an app line into the REST shape', () => {
      const entry = decoded({
        logName: 'projects/shop-dev/logs/run.googleapis.com%2Fstdout',
        resource: {
          type: 'cloud_run_revision',
          labels: { service_name: 'auth-service' },
        },
        insertId: 'abc',
        timestamp: { seconds: '1762776000', nanos: 123000000 },
        receiveTimestamp: { seconds: '1762776001', nanos: 0 },
        severity: 'ERROR',
        labels: { instanceId: 'i1' },
        trace: 'projects/shop-dev/traces/t1',
        jsonPayload: {
          fields: {
            level: { stringValue: 'error', kind: 'stringValue' },
            msg: { stringValue: 'Payment failed', kind: 'stringValue' },
            n: { numberValue: 3, kind: 'numberValue' },
            nested: {
              structValue: {
                fields: { ok: { boolValue: true, kind: 'boolValue' } },
              },
              kind: 'structValue',
            },
            list: {
              listValue: {
                values: [
                  { stringValue: 'a', kind: 'stringValue' },
                  { nullValue: 'NULL_VALUE', kind: 'nullValue' },
                ],
              },
              kind: 'listValue',
            },
          },
        },
        payload: 'jsonPayload',
      });

      expect(toGcpRestLogEntry(entry)).toEqual({
        logName: 'projects/shop-dev/logs/run.googleapis.com%2Fstdout',
        resource: {
          type: 'cloud_run_revision',
          labels: { service_name: 'auth-service' },
        },
        insertId: 'abc',
        timestamp: '2025-11-10T12:00:00.123Z',
        receiveTimestamp: '2025-11-10T12:00:01Z',
        severity: 'ERROR',
        labels: { instanceId: 'i1' },
        trace: 'projects/shop-dev/traces/t1',
        jsonPayload: {
          level: 'error',
          msg: 'Payment failed',
          n: 3,
          nested: { ok: true },
          list: ['a', null],
        },
      });
    });

    it('should turn a request line into the REST shape, latency as text', () => {
      const entry = decoded({
        logName: 'projects/shop-dev/logs/run.googleapis.com%2Frequests',
        timestamp: { seconds: '1762776000', nanos: 0 },
        severity: 'INFO',
        httpRequest: {
          requestMethod: 'GET',
          requestUrl: 'https://auth.example.com/auth/v1/me',
          requestSize: '0',
          status: 200,
          responseSize: '1234',
          userAgent: '',
          remoteIp: '',
          referer: '',
          cacheHit: false,
          cacheValidatedWithOriginServer: false,
          cacheLookup: false,
          cacheFillBytes: '0',
          serverIp: '',
          latency: { seconds: '0', nanos: 12000000 },
          protocol: '',
        },
        textPayload: '',
      });

      const rest = toGcpRestLogEntry(entry);
      expect(rest.httpRequest).toEqual({
        requestMethod: 'GET',
        requestUrl: 'https://auth.example.com/auth/v1/me',
        requestSize: '0',
        status: 200,
        responseSize: '1234',
        cacheFillBytes: '0',
        latency: '0.012s',
      });
      expect(rest.textPayload).toBeUndefined();
    });

    it('should keep a text payload', () => {
      const entry = decoded({
        timestamp: { seconds: '1762776000', nanos: 0 },
        textPayload: 'Listening on 8080',
        payload: 'textPayload',
      });

      expect(toGcpRestLogEntry(entry).textPayload).toBe('Listening on 8080');
    });

    it('should decode an audit entry', () => {
      const methodName = Buffer.from('storage.objects.get');
      const entry = decoded({
        resource: { type: 'gcs_bucket', labels: { bucket_name: 'b' } },
        timestamp: { seconds: '1762776002', nanos: 0 },
        severity: 'INFO',
        protoPayload: {
          type_url: 'type.googleapis.com/google.cloud.audit.AuditLog',
          value: Buffer.concat([
            Buffer.from([(8 << 3) | 2, methodName.length]),
            methodName,
          ]),
        },
        payload: 'protoPayload',
      });

      expect(toGcpRestLogEntry(entry).protoPayload).toEqual({
        '@type': 'type.googleapis.com/google.cloud.audit.AuditLog',
        methodName: 'storage.objects.get',
      });
    });
  });

  describe('Edge cases', () => {
    it('should leave out every unset field', () => {
      const entry = decoded({
        timestamp: { seconds: '1762776000', nanos: 0 },
      });

      const rest = toGcpRestLogEntry(entry) as Record<string, unknown>;
      // Entry gives an entry without an insertId its own, and turns the
      // timestamp into a Date (milliseconds)
      const { insertId: _insertId, ...others } = rest;
      expect(others).toEqual({ timestamp: '2025-11-10T12:00:00.000Z' });
    });

    it('should take the payload from the message when `data` has none', () => {
      expect(
        toGcpRestLogEntry({
          metadata: { textPayload: 'from the message' },
        }).textPayload,
      ).toBe('from the message');
    });
  });
});
