/**
 * Delete ECS Task Definition Family
 *
 * Deregisters every ACTIVE revision of a family (Terraform's first one and
 * those deploys registered), then deletes the INACTIVE ones, so nothing of
 * the family is left listed. Idempotent: a family without revisions is not
 * found, not an error.
 */

import {
  ECSClient,
  DeleteTaskDefinitionsCommand,
  DeregisterTaskDefinitionCommand,
  ListTaskDefinitionsCommand,
  type TaskDefinitionStatus,
} from '@aws-sdk/client-ecs';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';

export interface DeleteEcsTaskDefinitionFamilyOptions {
  credentials: AWSCredentials;
  family: string;
}

export interface DeleteEcsTaskDefinitionFamilyResult {
  success: boolean;
  deleted: boolean;
  error?: string;
}

/** DeleteTaskDefinitions takes at most 10 revisions per call */
const DELETE_BATCH = 10;

export async function deleteEcsTaskDefinitionFamily(
  options: DeleteEcsTaskDefinitionFamilyOptions,
): Promise<DeleteEcsTaskDefinitionFamilyResult> {
  const { credentials, family } = options;
  const ecs = new ECSClient(buildAWSClientConfig(credentials));

  // The family's revisions (the prefix also lists longer family names)
  const revisions = async (status: TaskDefinitionStatus): Promise<string[]> => {
    const arns: string[] = [];
    let nextToken: string | undefined;
    do {
      const page = await ecs.send(
        new ListTaskDefinitionsCommand({
          familyPrefix: family,
          status,
          nextToken,
        }),
      );
      arns.push(
        ...(page.taskDefinitionArns ?? []).filter(
          (arn) => arn.split('/').pop()?.replace(/:\d+$/, '') === family,
        ),
      );
      nextToken = page.nextToken;
    } while (nextToken);
    return arns;
  };

  try {
    const active = await revisions('ACTIVE');
    for (const arn of active) {
      await ecs.send(
        new DeregisterTaskDefinitionCommand({ taskDefinition: arn }),
      );
    }
    const inactive = await revisions('INACTIVE');
    for (let i = 0; i < inactive.length; i += DELETE_BATCH) {
      await ecs.send(
        new DeleteTaskDefinitionsCommand({
          taskDefinitions: inactive.slice(i, i + DELETE_BATCH),
        }),
      );
    }
    return {
      success: true,
      deleted: active.length > 0 || inactive.length > 0,
    };
  } catch (error) {
    return {
      success: false,
      deleted: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
