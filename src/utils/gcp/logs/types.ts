/**
 * GCP infra:logs Types
 */

/**
 * An entry from Cloud Logging's tail stream, as @google-cloud/logging hands
 * it over (its Entry): the decoded message and the payload
 */
export interface GcpTailEntry {
  metadata: Record<string, unknown>;
  data?: unknown;
}

/** What the tail stream hands over per response */
export interface GcpTailResponse {
  entries: GcpTailEntry[];
  /** Lines Google left out since the last response, with the reason */
  suppressionInfo?: unknown;
}

/**
 * One tail stream request. @google-cloud/logging adds the project
 * (`projects/{projectId}`) itself, so it isn't passed.
 */
export interface GcpTailRequest {
  filter: string;
}
