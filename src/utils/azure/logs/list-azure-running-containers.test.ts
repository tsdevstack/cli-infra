import { describe, it, expect, rs } from '@rstest/core';
import { listAzureRunningContainers } from './list-azure-running-containers';
import type { AzureContainerAppsClient } from './types';

function client(
  revisions: Array<{ name?: string; active?: boolean }>,
  replicas: Record<string, unknown[]>,
): AzureContainerAppsClient {
  return {
    containerAppsRevisions: {
      listRevisions: rs.fn(() =>
        (async function* () {
          yield* revisions;
        })(),
      ),
    },
    containerAppsRevisionReplicas: {
      listReplicas: rs.fn(
        async (_group: string, _app: string, revision: string) => ({
          value: replicas[revision] ?? [],
        }),
      ),
    },
  } as unknown as AzureContainerAppsClient;
}

const endpoint = (replica: string, container: string): string =>
  `https://westeurope.azurecontainerapps.dev/subscriptions/s/resourceGroups/shop-dev-rg/containerApps/shop-auth-service/revisions/r2/replicas/${replica}/containers/${container}/logstream`;

describe('listAzureRunningContainers', () => {
  describe('Standard use cases', () => {
    it('should list the running containers of the active revisions', async () => {
      const result = await listAzureRunningContainers(
        client(
          [
            { name: 'r1', active: false },
            { name: 'r2', active: true },
          ],
          {
            r1: [
              {
                name: 'old',
                containers: [
                  {
                    name: 'auth-service',
                    runningState: 'Running',
                    logStreamEndpoint: endpoint('old', 'auth-service'),
                  },
                ],
              },
            ],
            r2: [
              {
                name: 'a',
                containers: [
                  {
                    name: 'auth-service',
                    runningState: 'Running',
                    logStreamEndpoint: endpoint('a', 'auth-service'),
                  },
                ],
              },
              {
                name: 'b',
                containers: [
                  {
                    name: 'auth-service',
                    runningState: 'Waiting',
                    logStreamEndpoint: endpoint('b', 'auth-service'),
                  },
                ],
              },
            ],
          },
        ),
        'shop-dev-rg',
        'shop-auth-service',
      );

      expect(result).toEqual([
        {
          key: 'r2/a/auth-service',
          revision: 'r2',
          replica: 'a',
          container: 'auth-service',
          logStreamEndpoint: endpoint('a', 'auth-service'),
        },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should skip containers without a stream URL or a name', async () => {
      const result = await listAzureRunningContainers(
        client([{ name: 'r2', active: true }], {
          r2: [
            { name: 'a', containers: [{ name: 'x', runningState: 'Running' }] },
            {
              containers: [
                {
                  name: 'x',
                  runningState: 'Running',
                  logStreamEndpoint: endpoint('a', 'x'),
                },
              ],
            },
          ],
        }),
        'shop-dev-rg',
        'shop-auth-service',
      );

      expect(result).toEqual([]);
    });
  });
});
