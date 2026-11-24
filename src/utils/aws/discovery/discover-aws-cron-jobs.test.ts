import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockSend = rs.fn();
rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: class {
    send = mockSend;
  },
  ListTaskDefinitionFamiliesCommand: class {
    constructor(public input: unknown) {}
  },
  DescribeTaskDefinitionCommand: class {
    constructor(public input: { taskDefinition: string }) {}
  },
}));
rs.mock('@tsdevstack/infra-core', () => ({
  AWS_CRON_JOB_SERVICE_TAG: 'tsdevstack-cron-service',
  AWS_CRON_JOB_NAME_TAG: 'tsdevstack-cron-job',
  AWS_PROJECT_TAG: 'Project',
  CRON_JOB_NAME_PREFIX: 'cron-',
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-west-1' })),
}));

import { discoverAwsCronJobs } from './discover-aws-cron-jobs';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'k',
  secretAccessKey: 's',
  accountId: '123456789012',
};
const tags = (project: string, service?: string, job?: string) => [
  { key: 'Project', value: project },
  ...(service ? [{ key: 'tsdevstack-cron-service', value: service }] : []),
  ...(job ? [{ key: 'tsdevstack-cron-job', value: job }] : []),
];

describe('discoverAwsCronJobs', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it("should find this project's cron jobs by their tags, page by page", async () => {
    const byFamily: Record<string, unknown> = {
      'shop-cron-usage-report': tags('shop', 'auth-service', 'usage-report'),
      // A project named "shop-cron-x": same prefix, other project tag
      'shop-cron-x-cron-y': tags('shop-cron-x', 'svc', 'y'),
      // Not a cron job's definition
      'shop-cron-thing': tags('shop'),
    };
    mockSend.mockImplementation(
      async (command: { input: Record<string, unknown> }) => {
        if ('familyPrefix' in command.input) {
          return command.input.nextToken
            ? { families: ['shop-cron-thing'] }
            : {
                families: ['shop-cron-usage-report', 'shop-cron-x-cron-y'],
                nextToken: 't2',
              };
        }
        return { tags: byFamily[command.input.taskDefinition as string] };
      },
    );

    await expect(
      discoverAwsCronJobs({ projectName: 'shop', credentials }),
    ).resolves.toEqual([
      {
        name: 'usage-report',
        serviceName: 'auth-service',
        taskFamily: 'shop-cron-usage-report',
        containerName: 'cron-usage-report',
        logGroupName: '/ecs/shop/cron-usage-report',
        scheduleName: 'shop-auth-service-usage-report',
      },
    ]);
    expect(mockSend.mock.calls[0][0].input).toEqual({
      familyPrefix: 'shop-cron-',
      status: 'ACTIVE',
      nextToken: undefined,
    });
    expect(mockSend.mock.calls[1][0].input).toEqual({
      familyPrefix: 'shop-cron-',
      status: 'ACTIVE',
      nextToken: 't2',
    });
  });

  it("should pass the API's error on", async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(
      discoverAwsCronJobs({ projectName: 'shop', credentials }),
    ).rejects.toThrow('AccessDenied');
  });
});
