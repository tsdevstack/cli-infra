/**
 * The image an ECS service runs now
 */

import {
  ECSClient,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
} from '@aws-sdk/client-ecs';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';

/**
 * The container image of the service's current task definition.
 *
 * @returns undefined when the service doesn't exist, isn't ACTIVE, or still
 *   runs Terraform's first definition (`:latest`, which no deploy pushes):
 *   it was never deployed
 */
export async function getDeployedEcsImage(
  credentials: AWSCredentials,
  clusterName: string,
  serviceName: string,
): Promise<string | undefined> {
  const ecs = new ECSClient(buildAWSClientConfig(credentials));
  const { services } = await ecs.send(
    new DescribeServicesCommand({
      cluster: clusterName,
      services: [serviceName],
    }),
  );
  const service = services?.find(
    (s) => s.serviceName === serviceName && s.status === 'ACTIVE',
  );
  if (!service?.taskDefinition) {
    return undefined;
  }

  const { taskDefinition } = await ecs.send(
    new DescribeTaskDefinitionCommand({
      taskDefinition: service.taskDefinition,
    }),
  );
  const image = taskDefinition?.containerDefinitions?.[0]?.image;
  if (!image || image.endsWith(':latest')) {
    return undefined;
  }
  return image;
}
