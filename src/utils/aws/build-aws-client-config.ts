/**
 * Build AWS Client Config
 *
 * Creates configuration object for AWS SDK clients.
 * In CI, uses environment-based credentials (auto-discovered by SDK).
 * Locally, uses explicit credentials from the credentials file.
 */

import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../context';

export interface AWSClientConfig {
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

/**
 * Build configuration for AWS SDK clients
 */
export function buildAWSClientConfig(
  credentials: AWSCredentials,
): AWSClientConfig {
  const { isCIEnv } = getContext();

  // In CI, SDK auto-discovers credentials from environment
  // (set by aws-actions/configure-aws-credentials)
  if (isCIEnv()) {
    return {
      region: credentials.region,
    };
  }

  // Local: explicit credentials
  return {
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      ...(credentials.sessionToken
        ? { sessionToken: credentials.sessionToken }
        : {}),
    },
  };
}
