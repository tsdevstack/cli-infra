/**
 * Disable ALB Deletion Protection
 *
 * Uses @aws-sdk/client-elastic-load-balancing-v2 to turn off deletion
 * protection on the Application Load Balancer. The generated alb.tf keeps it
 * on, so this must be done before `terraform destroy` can delete the ALB.
 */

import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeLoadBalancerAttributesCommand,
  ModifyLoadBalancerAttributesCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from './build-aws-client-config';
import type { DisableDeletionProtectionResult } from './disable-deletion-protection';

const DELETION_PROTECTION_ATTRIBUTE = 'deletion_protection.enabled';

export interface DisableAlbDeletionProtectionOptions {
  loadBalancerName: string;
  credentials: AWSCredentials;
}

/**
 * Disable deletion protection on an Application Load Balancer
 *
 * Checks current state first — only modifies if protection is enabled.
 */
export async function disableAlbDeletionProtection(
  options: DisableAlbDeletionProtectionOptions,
): Promise<DisableDeletionProtectionResult> {
  const clientConfig = buildAWSClientConfig(options.credentials);
  const elb = new ElasticLoadBalancingV2Client(clientConfig);

  try {
    const describeResponse = await elb.send(
      new DescribeLoadBalancersCommand({
        Names: [options.loadBalancerName],
      }),
    );

    const loadBalancerArn =
      describeResponse.LoadBalancers?.[0]?.LoadBalancerArn;
    if (!loadBalancerArn) {
      return { success: true, wasAlreadyDisabled: true };
    }

    const attributesResponse = await elb.send(
      new DescribeLoadBalancerAttributesCommand({
        LoadBalancerArn: loadBalancerArn,
      }),
    );

    const protection = attributesResponse.Attributes?.find(
      (attribute) => attribute.Key === DELETION_PROTECTION_ATTRIBUTE,
    );
    if (protection?.Value !== 'true') {
      return { success: true, wasAlreadyDisabled: true };
    }

    await elb.send(
      new ModifyLoadBalancerAttributesCommand({
        LoadBalancerArn: loadBalancerArn,
        Attributes: [{ Key: DELETION_PROTECTION_ATTRIBUTE, Value: 'false' }],
      }),
    );

    return { success: true };
  } catch (error: unknown) {
    const err = error as { name?: string; message?: string };

    // Load balancer not found — nothing to disable
    if (err.name === 'LoadBalancerNotFoundException') {
      return { success: true, wasAlreadyDisabled: true };
    }

    return {
      success: false,
      error: err.message || 'Unknown error',
    };
  }
}
