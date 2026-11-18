/**
 * A protoPayload from Cloud Logging's tail stream as the REST API writes it.
 *
 * The stream sends protoPayload as a protobuf Any: the type and the encoded
 * bytes. Audit entries (google.cloud.audit.AuditLog: bucket access, Cloud
 * Run's admin and system events) are decoded with the fields the log lines
 * use (GCP_AUDIT_LOG_DESCRIPTOR); any other type, or bytes that don't
 * decode, keep only their `@type`.
 */

import protobuf from 'protobufjs';
import {
  GCP_AUDIT_LOG_DESCRIPTOR,
  GCP_AUDIT_LOG_TYPE_URL,
} from '../../../constants';

let auditLogType: protobuf.Type | undefined;

export function decodeGcpAuditLog(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const any = value as {
    type_url?: unknown;
    typeUrl?: unknown;
    value?: unknown;
  };
  const typeUrl = any.type_url ?? any.typeUrl;
  if (typeof typeUrl !== 'string' || typeUrl === '') {
    return undefined;
  }

  const bytes = any.value;
  if (typeUrl !== GCP_AUDIT_LOG_TYPE_URL || !(bytes instanceof Uint8Array)) {
    return { '@type': typeUrl };
  }

  try {
    auditLogType ??= protobuf.Root.fromJSON(
      GCP_AUDIT_LOG_DESCRIPTOR,
    ).lookupType('AuditLog');
    const decoded = auditLogType.toObject(auditLogType.decode(bytes), {
      defaults: false,
    });
    return { '@type': typeUrl, ...decoded };
  } catch {
    return { '@type': typeUrl };
  }
}
