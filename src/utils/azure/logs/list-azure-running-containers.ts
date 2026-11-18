/**
 * The running containers of a Container App: every container of every
 * replica of its active revisions that is running, with its log stream URL.
 * A replica that is starting or stopping is left out (its stream would
 * fail); the next check picks it up.
 */

import type { AzureContainerAppsClient, AzureReplicaContainer } from './types';

export async function listAzureRunningContainers(
  client: AzureContainerAppsClient,
  resourceGroup: string,
  app: string,
): Promise<AzureReplicaContainer[]> {
  const containers: AzureReplicaContainer[] = [];

  for await (const revision of client.containerAppsRevisions.listRevisions(
    resourceGroup,
    app,
  )) {
    if (!revision.active || !revision.name) {
      continue;
    }
    const replicas = await client.containerAppsRevisionReplicas.listReplicas(
      resourceGroup,
      app,
      revision.name,
    );
    for (const replica of replicas.value ?? []) {
      for (const container of replica.containers ?? []) {
        if (
          replica.name &&
          container.name &&
          container.logStreamEndpoint &&
          container.runningState === 'Running'
        ) {
          containers.push({
            key: `${revision.name}/${replica.name}/${container.name}`,
            revision: revision.name,
            replica: replica.name,
            container: container.name,
            logStreamEndpoint: container.logStreamEndpoint,
          });
        }
      }
    }
  }

  return containers;
}
