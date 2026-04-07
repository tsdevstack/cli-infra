/**
 * Wait for GCP API service agents to propagate
 *
 * After enabling GCP APIs, Google automatically creates service agents
 * and adds IAM bindings. This can cause quota exhaustion if IAM changes
 * are made too quickly after API enablement.
 */

const API_PROPAGATION_DELAY_MS = 15000;

export async function waitForApiPropagation(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, API_PROPAGATION_DELAY_MS));
}
