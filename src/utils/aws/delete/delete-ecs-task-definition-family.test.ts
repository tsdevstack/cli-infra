import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockSend = rs.fn();
rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: class {
    send = mockSend;
  },
  ListTaskDefinitionsCommand: class {
    readonly kind = 'list';
    constructor(public input: { status: string; nextToken?: string }) {}
  },
  DeregisterTaskDefinitionCommand: class {
    readonly kind = 'deregister';
    constructor(public input: unknown) {}
  },
  DeleteTaskDefinitionsCommand: class {
    readonly kind = 'delete';
    constructor(public input: unknown) {}
  },
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-west-1' })),
}));

import { deleteEcsTaskDefinitionFamily } from './delete-ecs-task-definition-family';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'k',
  secretAccessKey: 's',
  accountId: '123456789012',
};
const arn = (family: string, revision: number) =>
  `arn:aws:ecs:eu-west-1:123456789012:task-definition/${family}:${revision}`;

describe('deleteEcsTaskDefinitionFamily', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it("should deregister the family's active revisions, then delete the inactive ones, leaving longer family names alone", async () => {
    const calls: Array<{ kind: string; input: unknown }> = [];
    mockSend.mockImplementation(
      async (command: { kind: string; input: { status?: string } }) => {
        calls.push(command);
        if (command.kind !== 'list') return {};
        return command.input.status === 'ACTIVE'
          ? {
              taskDefinitionArns: [
                arn('shop-cron-usage', 1),
                arn('shop-cron-usage', 2),
                arn('shop-cron-usage-report', 1),
              ],
            }
          : {
              taskDefinitionArns: [
                arn('shop-cron-usage', 1),
                arn('shop-cron-usage', 2),
              ],
            };
      },
    );

    await expect(
      deleteEcsTaskDefinitionFamily({ credentials, family: 'shop-cron-usage' }),
    ).resolves.toEqual({ success: true, deleted: true });

    expect(
      calls.filter((c) => c.kind === 'deregister').map((c) => c.input),
    ).toEqual([
      { taskDefinition: arn('shop-cron-usage', 1) },
      { taskDefinition: arn('shop-cron-usage', 2) },
    ]);
    expect(
      calls.filter((c) => c.kind === 'delete').map((c) => c.input),
    ).toEqual([
      {
        taskDefinitions: [arn('shop-cron-usage', 1), arn('shop-cron-usage', 2)],
      },
    ]);
  });

  it('should find nothing to delete for a family without revisions', async () => {
    mockSend.mockResolvedValue({ taskDefinitionArns: [] });

    await expect(
      deleteEcsTaskDefinitionFamily({ credentials, family: 'shop-cron-x' }),
    ).resolves.toEqual({ success: true, deleted: false });
  });

  it("should report AWS's error", async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(
      deleteEcsTaskDefinitionFamily({ credentials, family: 'shop-cron-x' }),
    ).resolves.toEqual({
      success: false,
      deleted: false,
      error: 'AccessDenied',
    });
  });
});
