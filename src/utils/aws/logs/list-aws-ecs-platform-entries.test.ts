import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import {
  DescribeServicesCommand,
  DescribeTasksCommand,
  ListTasksCommand,
  type ECSClient,
} from '@aws-sdk/client-ecs';
import { listAwsEcsPlatformEntries } from './list-aws-ecs-platform-entries';

const send = rs.fn();
const ecs = { send } as unknown as ECSClient;

const SINCE = new Date('2026-10-30T11:00:00.000Z');
const UNTIL = new Date('2026-10-30T12:00:00.000Z');

describe('listAwsEcsPlatformEntries', () => {
  beforeEach(() => {
    send.mockReset();
  });

  describe('Standard use cases', () => {
    it('should list service events and stopped tasks in the window, oldest first', async () => {
      send.mockImplementation(async (command: unknown) => {
        if (command instanceof DescribeServicesCommand) {
          return {
            services: [
              {
                serviceName: 'auth-service',
                events: [
                  {
                    createdAt: new Date('2026-10-30T11:30:00.000Z'),
                    message:
                      '(service auth-service) has reached a steady state.',
                  },
                  {
                    createdAt: new Date('2026-10-30T10:00:00.000Z'),
                    message: '(service auth-service) too old',
                  },
                ],
              },
            ],
          };
        }
        if (command instanceof ListTasksCommand) {
          if (command.input.serviceName === 'auth-service') {
            return { taskArns: ['arn:aws:ecs:r:1:task/c/aaaaaaaa1111'] };
          }
          return command.input.family === 'shop-migrate-auth-service'
            ? { taskArns: ['arn:aws:ecs:r:1:task/c/bbbbbbbb2222'] }
            : { taskArns: [] };
        }
        if (command instanceof DescribeTasksCommand) {
          const arn = command.input.tasks?.[0] ?? '';
          return arn.includes('aaaa')
            ? {
                tasks: [
                  {
                    taskArn: arn,
                    stoppedAt: new Date('2026-10-30T11:10:00.000Z'),
                    stopCode: 'EssentialContainerExited',
                    stoppedReason: 'Essential container in task exited',
                    containers: [{ name: 'auth-service', exitCode: 1 }],
                  },
                ],
              }
            : {
                tasks: [
                  {
                    taskArn: arn,
                    stoppedAt: new Date('2026-10-30T11:05:00.000Z'),
                    stopCode: 'EssentialContainerExited',
                    stoppedReason: 'Essential container in task exited',
                    containers: [{ name: 'migration', exitCode: 0 }],
                  },
                ],
              };
        }
        throw new Error('unexpected command');
      });

      const entries = await listAwsEcsPlatformEntries({
        ecs,
        projectName: 'shop',
        clusterName: 'shop-cluster',
        sources: [
          { name: 'auth-service', type: 'service' },
          { name: 'migrate-auth-service', type: 'migration' },
          { name: 'edge', type: 'edge' },
        ],
        since: SINCE,
        until: UNTIL,
      });

      expect(
        entries.map((entry) => [
          entry.time,
          entry.source,
          entry.level,
          entry.message,
        ]),
      ).toEqual([
        [
          '2026-10-30T11:05:00.000Z',
          'migrate-auth-service',
          'info',
          'Task bbbbbbbb stopped: Essential container in task exited; migration exit 0',
        ],
        [
          '2026-10-30T11:10:00.000Z',
          'auth-service',
          'error',
          'Task aaaaaaaa stopped: Essential container in task exited; auth-service exit 1',
        ],
        [
          '2026-10-30T11:30:00.000Z',
          'auth-service',
          'info',
          'has reached a steady state.',
        ],
      ]);

      const listCalls = send.mock.calls
        .map((call) => call[0])
        .filter((command) => command instanceof ListTasksCommand)
        .map((command) => (command as ListTasksCommand).input);
      expect(listCalls).toEqual([
        {
          cluster: 'shop-cluster',
          desiredStatus: 'STOPPED',
          serviceName: 'auth-service',
        },
        {
          cluster: 'shop-cluster',
          desiredStatus: 'STOPPED',
          family: 'shop-migrate-auth-service',
        },
        // The family without the project, from deploys before it was added
        {
          cluster: 'shop-cluster',
          desiredStatus: 'STOPPED',
          family: 'migrate-auth-service-migration',
        },
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should warn about events that report a problem', async () => {
      send.mockImplementation(async (command: unknown) => {
        if (command instanceof DescribeServicesCommand) {
          return {
            services: [
              {
                serviceName: 'kong',
                events: [
                  {
                    createdAt: new Date('2026-10-30T11:30:00.000Z'),
                    message:
                      '(service kong) was unable to place a task because no container instance met all of its requirements.',
                  },
                ],
              },
            ],
          };
        }
        return { taskArns: [] };
      });

      const entries = await listAwsEcsPlatformEntries({
        ecs,
        projectName: 'shop',
        clusterName: 'shop-cluster',
        sources: [{ name: 'kong', type: 'kong' }],
        since: SINCE,
        until: UNTIL,
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('warn');
    });

    it("should list the database setup job's stopped tasks by its family", async () => {
      send.mockImplementation(async (command: unknown) => {
        if (command instanceof ListTasksCommand) {
          return command.input.family === 'shop-db-init'
            ? { taskArns: ['arn:task/cccccccc'] }
            : { taskArns: [] };
        }
        if (command instanceof DescribeTasksCommand) {
          return {
            tasks: [
              {
                taskArn: 'arn:aws:ecs:eu-west-1:1:task/shop-cluster/cccccccc',
                stoppedAt: new Date('2026-10-30T11:40:00.000Z'),
                stoppedReason: 'Essential container in task exited',
                containers: [{ name: 'db-init', exitCode: 0 }],
              },
            ],
          };
        }
        return {};
      });

      const entries = await listAwsEcsPlatformEntries({
        ecs,
        projectName: 'shop',
        clusterName: 'shop-cluster',
        sources: [{ name: 'db-init', type: 'db-init' }],
        since: SINCE,
        until: UNTIL,
      });

      expect(entries.map((entry) => [entry.source, entry.kind])).toEqual([
        ['db-init', 'platform'],
      ]);
      const listed = send.mock.calls
        .map(([command]) => command)
        .filter((command) => command instanceof ListTasksCommand)
        .map((command) => (command as ListTasksCommand).input);
      expect(listed).toEqual([
        {
          cluster: 'shop-cluster',
          desiredStatus: 'STOPPED',
          family: 'shop-db-init',
        },
      ]);
      expect(
        send.mock.calls.some(
          ([command]) => command instanceof DescribeServicesCommand,
        ),
      ).toBe(false);
    });

    it('should call nothing without ECS sources', async () => {
      const entries = await listAwsEcsPlatformEntries({
        ecs,
        projectName: 'shop',
        clusterName: 'shop-cluster',
        sources: [{ name: 'edge', type: 'edge' }],
        since: SINCE,
        until: UNTIL,
      });
      expect(entries).toEqual([]);
      expect(send).not.toHaveBeenCalled();
    });
  });
});
