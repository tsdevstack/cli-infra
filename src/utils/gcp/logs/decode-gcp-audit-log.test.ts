import { describe, it, expect } from '@rstest/core';
import { decodeGcpAuditLog } from './decode-gcp-audit-log';

const AUDIT_LOG = 'type.googleapis.com/google.cloud.audit.AuditLog';

/**
 * Protobuf wire format by hand, with the field numbers of Google's
 * audit_log.proto and status.proto, so the test doesn't reuse the
 * descriptor it checks
 */
function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }
  bytes.push(rest);
  return Buffer.from(bytes);
}
function text(field: number, value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([
    encodeVarint((field << 3) | 2),
    encodeVarint(bytes.length),
    bytes,
  ]);
}
function message(field: number, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  return Buffer.concat([
    encodeVarint((field << 3) | 2),
    encodeVarint(body.length),
    body,
  ]);
}
function varint(field: number, value: number): Buffer {
  return Buffer.concat([encodeVarint(field << 3), encodeVarint(value)]);
}

describe('decodeGcpAuditLog', () => {
  describe('Standard use cases', () => {
    it('should decode a bucket access entry into the REST shape', () => {
      const bytes = Buffer.concat([
        message(2, varint(1, 7), text(2, 'Access denied.')), // status
        message(3, text(1, 'deploy@shop-dev.iam.gserviceaccount.com')), // authenticationInfo
        message(4, text(1, '203.0.113.7'), text(2, 'curl/8')), // requestMetadata
        text(7, 'storage.googleapis.com'), // serviceName
        text(8, 'storage.objects.get'), // methodName
        text(11, 'projects/_/buckets/shop-dev-uploads/objects/a.png'), // resourceName
      ]);

      expect(decodeGcpAuditLog({ type_url: AUDIT_LOG, value: bytes })).toEqual({
        '@type': AUDIT_LOG,
        status: { code: 7, message: 'Access denied.' },
        authenticationInfo: {
          principalEmail: 'deploy@shop-dev.iam.gserviceaccount.com',
        },
        requestMetadata: {
          callerIp: '203.0.113.7',
          callerSuppliedUserAgent: 'curl/8',
        },
        serviceName: 'storage.googleapis.com',
        methodName: 'storage.objects.get',
        resourceName: 'projects/_/buckets/shop-dev-uploads/objects/a.png',
      });
    });

    it('should skip the fields the lines do not use', () => {
      const bytes = Buffer.concat([
        text(8, 'google.cloud.run.v1.Services.ReplaceService'),
        message(16, text(1, 'ignored')), // request (a Struct)
      ]);

      expect(decodeGcpAuditLog({ typeUrl: AUDIT_LOG, value: bytes })).toEqual({
        '@type': AUDIT_LOG,
        methodName: 'google.cloud.run.v1.Services.ReplaceService',
      });
    });
  });

  describe('Edge cases', () => {
    it('should keep only the type of other payloads', () => {
      expect(
        decodeGcpAuditLog({
          type_url:
            'type.googleapis.com/google.appengine.logging.v1.RequestLog',
          value: Buffer.from([1, 2, 3]),
        }),
      ).toEqual({
        '@type': 'type.googleapis.com/google.appengine.logging.v1.RequestLog',
      });
    });

    it('should keep only the type when the bytes do not decode', () => {
      expect(
        decodeGcpAuditLog({
          type_url: AUDIT_LOG,
          // Wire type 7 doesn't exist
          value: Buffer.from([0x0f, 0x00]),
        }),
      ).toEqual({ '@type': AUDIT_LOG });
    });

    it('should return undefined without a type', () => {
      expect(decodeGcpAuditLog(undefined)).toBeUndefined();
      expect(decodeGcpAuditLog({ value: Buffer.from([]) })).toBeUndefined();
    });
  });
});
