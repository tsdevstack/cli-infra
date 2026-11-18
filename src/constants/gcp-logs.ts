/**
 * GCP constants for infra:logs (Cloud Logging)
 */

/**
 * Entries per entries.list call. 1000 is the API's maximum; each call
 * counts against the 60 reads per minute per project.
 */
export const GCP_LOGS_PAGE_SIZE = 1000;

/**
 * Log IDs of a Cloud Run container's own output (stdout and stderr). Every
 * other log of a Cloud Run service or job (requests, system, audit) is a
 * platform line.
 */
export const GCP_RUN_APP_LOG_IDS = [
  'run.googleapis.com/stdout',
  'run.googleapis.com/stderr',
] as const;

/** OAuth scope for reading logs */
export const GCP_LOGGING_READ_SCOPE =
  'https://www.googleapis.com/auth/logging.read';

/**
 * Log ID of Data Access audit logs, where Cloud Storage writes every read
 * and write of the storage buckets (in a filter: `log_id("...")`)
 */
export const GCP_DATA_ACCESS_LOG_ID = 'cloudaudit.googleapis.com/data_access';

/** Name suffix of the load balancer's URL map (`{project}-urlmap`) */
export const GCP_URL_MAP_SUFFIX = '-urlmap';

/**
 * --follow: a Cloud Logging tail stream counts as open after its first
 * response, or after this long without an error (the SDK doesn't say when
 * Google accepted it; a missing permission fails within a second or two)
 */
export const GCP_LOGS_TAIL_OPEN_AFTER_MS = 3000;

/** protoPayload type of audit entries (bucket access, Cloud Run's events) */
export const GCP_AUDIT_LOG_TYPE_URL =
  'type.googleapis.com/google.cloud.audit.AuditLog';

/**
 * The fields of google.cloud.audit.AuditLog that log lines use, as a
 * protobufjs JSON descriptor, for decoding audit entries from the tail
 * stream (it sends them as bytes). Field numbers from Google's
 * google/cloud/audit/audit_log.proto and google/rpc/status.proto; names as
 * the REST API writes them. Other fields are skipped when decoding.
 */
export const GCP_AUDIT_LOG_DESCRIPTOR = {
  nested: {
    AuditLog: {
      fields: {
        status: { type: 'Status', id: 2 },
        authenticationInfo: { type: 'AuthenticationInfo', id: 3 },
        requestMetadata: { type: 'RequestMetadata', id: 4 },
        serviceName: { type: 'string', id: 7 },
        methodName: { type: 'string', id: 8 },
        resourceName: { type: 'string', id: 11 },
      },
    },
    Status: {
      fields: {
        code: { type: 'int32', id: 1 },
        message: { type: 'string', id: 2 },
      },
    },
    AuthenticationInfo: {
      fields: {
        principalEmail: { type: 'string', id: 1 },
        principalSubject: { type: 'string', id: 8 },
      },
    },
    RequestMetadata: {
      fields: {
        callerIp: { type: 'string', id: 1 },
        callerSuppliedUserAgent: { type: 'string', id: 2 },
      },
    },
  },
} as const;
