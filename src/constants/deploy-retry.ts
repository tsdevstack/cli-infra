/**
 * Deploy retry constants
 */

/**
 * Retries of a Terraform apply that failed only for lack of cloud capacity
 * (infra-core CLOUD_CAPACITY_ERROR_PATTERNS). With the delay below, a deploy
 * waits up to 15 minutes for capacity before it gives up.
 */
export const CAPACITY_RETRY_ATTEMPTS = 3;

/**
 * Wait before each capacity retry. Providers say capacity shifts within
 * minutes; a shortage seen in an Azure round cleared within about 15.
 */
export const CAPACITY_RETRY_DELAY_MS = 5 * 60 * 1000;

/**
 * GCP, first deploy of a new project: Google creates the Service Networking
 * service agent on the first CreateConnection call, and that call's operation
 * can fail with "Error code 16 ... invalid authentication credentials" while
 * the agent is created (seen 2026-10-23: agent and its role granted 1 s after
 * the call, Terraform's own retry 4 s later still failed, the rerun passed).
 * The deploy applies again after a wait, at most this many times.
 */
export const GCP_SERVICE_AGENT_RETRY_ATTEMPTS = 5;

/**
 * Wait before each Service Networking agent retry. Google: an IAM change
 * takes "typically 2 minutes, potentially 7 minutes or longer" to take
 * effect; 5 retries of 2 minutes cover 10 minutes.
 */
export const GCP_SERVICE_AGENT_RETRY_DELAY_MS = 2 * 60 * 1000;
