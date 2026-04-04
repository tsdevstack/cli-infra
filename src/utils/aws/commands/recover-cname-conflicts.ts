/**
 * Recover from CloudFront CNAME Conflicts
 *
 * When terraform apply fails with CNAMEAlreadyExists, finds the orphaned
 * CloudFront distributions and imports them into Terraform state.
 */

import {
  CloudFrontClient,
  ListDistributionsCommand,
  type DistributionSummary,
} from '@aws-sdk/client-cloudfront';
import { getContext } from '../../../context';
import { extractCnameConflicts } from '@tsdevstack/infra-core';
import { executeTerraform } from '../terraform';
import { buildRuntime } from '../../build-runtime';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import type { AWSInfraConfig } from '@tsdevstack/infra-core';

interface RecoverCnameConflictsOptions {
  applyOutput: string;
  workDir: string;
  tfEnv: Record<string, string>;
  credentials: AWSCredentials;
  generateConfig: AWSInfraConfig;
}

interface RecoverResult {
  recovered: boolean;
  importedCount: number;
}

/**
 * Attempt to recover from CloudFront CNAME conflicts by importing
 * orphaned distributions into Terraform state.
 */
export async function recoverCnameConflicts(
  options: RecoverCnameConflictsOptions,
): Promise<RecoverResult> {
  const { logger } = getContext();
  const { applyOutput, workDir, tfEnv, credentials, generateConfig } = options;

  const conflicts = extractCnameConflicts(applyOutput);
  if (conflicts.length === 0) {
    return { recovered: false, importedCount: 0 };
  }

  logger.newline();
  logger.warn(
    `Found ${conflicts.length} CloudFront CNAME conflict(s) — attempting recovery...`,
  );

  let cnameMap: Map<string, string>;
  try {
    cnameMap = await buildCnameMap(credentials);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Failed to list CloudFront distributions: ${message}`);
    return { recovered: false, importedCount: 0 };
  }

  if (cnameMap.size === 0) {
    logger.error('No CloudFront distributions found in account');
    return { recovered: false, importedCount: 0 };
  }

  let importedCount = 0;

  for (const conflict of conflicts) {
    const expectedCnames = getExpectedCnames(conflict.address, generateConfig);

    if (expectedCnames.length === 0) {
      logger.warn(
        `  Could not determine CNAMEs for ${conflict.address} — manual import needed`,
      );
      continue;
    }

    // Find the distribution that has one of our expected CNAMEs
    let distributionId: string | null = null;
    for (const cname of expectedCnames) {
      const id = cnameMap.get(cname);
      if (id) {
        distributionId = id;
        break;
      }
    }

    if (!distributionId) {
      logger.warn(
        `  No distribution found with CNAMEs [${expectedCnames.join(', ')}]`,
      );
      continue;
    }

    logger.info(
      `  Importing ${conflict.address} ← distribution ${distributionId}`,
    );

    const importResult = await executeTerraform('import', {
      workDir,
      env: tfEnv,
      importAddress: conflict.address,
      importId: distributionId,
    });

    if (importResult.success) {
      logger.success(`  ✓ Imported ${conflict.address}`);
      importedCount++;
    } else {
      logger.error(`  ✗ Failed to import ${conflict.address}`);
    }
  }

  return {
    recovered: importedCount === conflicts.length,
    importedCount,
  };
}

/**
 * Determine expected CNAME aliases for a CloudFront resource address.
 *
 * Maps Terraform resource addresses to their configured domains:
 * - aws_cloudfront_distribution.main → api.{baseDomain}
 * - aws_cloudfront_distribution.spa["name"] → spas[name].domain
 * - aws_cloudfront_distribution.nextjs["name"] → frontends[name].domain
 */
function getExpectedCnames(address: string, config: AWSInfraConfig): string[] {
  // Main CloudFront (API gateway)
  if (address === 'aws_cloudfront_distribution.main') {
    if (!config.baseDomain) return [];
    return [`api.${config.baseDomain}`];
  }

  // SPA CloudFront: aws_cloudfront_distribution.spa["react-app"]
  const spaMatch = address.match(
    /aws_cloudfront_distribution\.spa\["([^"]+)"\]/,
  );
  if (spaMatch) {
    const spaName = spaMatch[1];
    const spa = config.spas[spaName];
    if (spa?.domain) return [spa.domain];
    return [];
  }

  // Next.js CloudFront: aws_cloudfront_distribution.nextjs["frontend"]
  const nextjsMatch = address.match(
    /aws_cloudfront_distribution\.nextjs\["([^"]+)"\]/,
  );
  if (nextjsMatch) {
    const frontendName = nextjsMatch[1];
    const frontend = config.frontends[frontendName];
    if (frontend?.domain) return [frontend.domain];
    return [];
  }

  return [];
}

/**
 * List all CloudFront distributions and build a map of CNAME → distribution ID
 */
async function buildCnameMap(
  credentials: AWSCredentials,
): Promise<Map<string, string>> {
  const runtime = buildRuntime();

  const clientConfig: {
    region: string;
    credentials?: { accessKeyId: string; secretAccessKey: string };
  } = {
    region: 'us-east-1',
  };

  if (!runtime.isCIEnv()) {
    clientConfig.credentials = {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    };
  }

  const client = new CloudFrontClient(clientConfig);
  const cnameMap = new Map<string, string>();

  let marker: string | undefined;

  do {
    const response = await client.send(
      new ListDistributionsCommand({
        Marker: marker,
      }),
    );

    const items: DistributionSummary[] = response.DistributionList?.Items ?? [];

    for (const dist of items) {
      if (!dist.Id) continue;
      const aliases = dist.Aliases?.Items ?? [];
      for (const alias of aliases) {
        cnameMap.set(alias, dist.Id);
      }
    }

    marker = response.DistributionList?.IsTruncated
      ? response.DistributionList.NextMarker
      : undefined;
  } while (marker);

  return cnameMap;
}
