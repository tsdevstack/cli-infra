import { describe, it, expect, rs, beforeEach } from '@rstest/core';

class MockCliError extends Error {
  constructor(
    message: string,
    public context?: string,
    public hint?: string,
  ) {
    super(message);
  }
}
rs.mock('../../../context', () => ({
  getContext: () => ({ CliError: MockCliError }),
}));

import {
  DescribeLogGroupsCommand,
  type CloudWatchLogsClient,
} from '@aws-sdk/client-cloudwatch-logs';
import { listAwsExistingLogGroups } from './list-aws-existing-log-groups';

const send = rs.fn();
const client = { send } as unknown as CloudWatchLogsClient;

describe('listAwsExistingLogGroups', () => {
  beforeEach(() => {
    send.mockReset();
  });

  describe('Standard use cases', () => {
    it('should return the groups that exist, with the ARN Live Tail takes', async () => {
      send.mockResolvedValueOnce({
        logGroups: [
          {
            logGroupName: '/ecs/shop/auth-service',
            arn: 'arn:aws:logs:eu-west-1:123:log-group:/ecs/shop/auth-service:*',
            logGroupArn:
              'arn:aws:logs:eu-west-1:123:log-group:/ecs/shop/auth-service',
            logGroupClass: 'STANDARD',
          },
          {
            logGroupName: '/ecs/shop/kong',
            arn: 'arn:aws:logs:eu-west-1:123:log-group:/ecs/shop/kong:*',
          },
        ],
      });

      const found = await listAwsExistingLogGroups(client, [
        '/ecs/shop/auth-service',
        '/ecs/shop/kong',
        '/ecs/shop/migrate-auth-service',
        '/ecs/shop/kong',
      ]);

      const command = send.mock.calls[0][0] as DescribeLogGroupsCommand;
      expect(command).toBeInstanceOf(DescribeLogGroupsCommand);
      expect(command.input).toEqual({
        logGroupIdentifiers: [
          '/ecs/shop/auth-service',
          '/ecs/shop/kong',
          '/ecs/shop/migrate-auth-service',
        ],
      });
      expect([...found]).toEqual([
        [
          '/ecs/shop/auth-service',
          {
            arn: 'arn:aws:logs:eu-west-1:123:log-group:/ecs/shop/auth-service',
            logGroupClass: 'STANDARD',
          },
        ],
        [
          '/ecs/shop/kong',
          { arn: 'arn:aws:logs:eu-west-1:123:log-group:/ecs/shop/kong' },
        ],
      ]);
    });

    it('should ask in batches of 50 names', async () => {
      send.mockResolvedValue({ logGroups: [] });
      const names = Array.from({ length: 51 }, (_, i) => `/ecs/shop/s${i}`);

      await listAwsExistingLogGroups(client, names);

      expect(
        send.mock.calls.map(
          (call) =>
            (call[0] as DescribeLogGroupsCommand).input.logGroupIdentifiers
              ?.length,
        ),
      ).toEqual([50, 1]);
    });
  });

  describe('Edge cases', () => {
    it('should name the missing permission', async () => {
      send.mockRejectedValueOnce(
        Object.assign(new Error('not authorized'), {
          name: 'AccessDeniedException',
        }),
      );

      await expect(
        listAwsExistingLogGroups(client, ['/ecs/shop/kong']),
      ).rejects.toMatchObject({
        message: 'Cannot list the CloudWatch log groups: not authorized',
        hint: 'The deploy credentials need logs:DescribeLogGroups.',
      });
    });

    it('should not call AWS without names', async () => {
      expect(await listAwsExistingLogGroups(client, [])).toEqual(new Map());
      expect(send).not.toHaveBeenCalled();
    });
  });
});
