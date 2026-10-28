/**
 * DNS Check Constants
 */

/** Lookups a deploy makes to see whether the registrar's records are in place */
export const DNS_CHECK = {
  timeoutMs: 3000,
  tries: 2,
} as const;
