import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const mockSend = rs.fn();
rs.mock('@aws-sdk/client-ecs', () => ({
  ECSClient: class {
    send = mockSend;
  },
  DescribeServicesCommand: class {
    constructor(public input: unknown) {}
  },
  DescribeTaskDefinitionCommand: class {
    constructor(public input: unknown) {}
  },
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-west-1' })),
}));

import { getDeployedEcsImage } from './get-deployed-ecs-image';

const credentials = {
  region: 'eu-west-1',
  accessKeyId: 'k',
  secretAccessKey: 's',
  accountId: '123456789012',
};

describe('getDeployedEcsImage', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  it("should read the image of the service's current task definition", async () => {
    mockSend
      .mockResolvedValueOnce({
        services: [
          {
            serviceName: 'auth-service',
            status: 'ACTIVE',
            taskDefinition: 'arn:td/shop-auth-service:5',
          },
        ],
      })
      .mockResolvedValueOnce({
        taskDefinition: {
          containerDefinitions: [{ image: 'repo/auth-service:abc123' }],
        },
      });

    await expect(
      getDeployedEcsImage(credentials, 'shop-cluster', 'auth-service'),
    ).resolves.toBe('repo/auth-service:abc123');
    expect(mockSend.mock.calls[0][0].input).toEqual({
      cluster: 'shop-cluster',
      services: ['auth-service'],
    });
    expect(mockSend.mock.calls[1][0].input).toEqual({
      taskDefinition: 'arn:td/shop-auth-service:5',
    });
  });

  it('should find nothing for a missing or inactive service', async () => {
    mockSend.mockResolvedValueOnce({
      services: [],
      failures: [{ reason: 'MISSING' }],
    });
    await expect(
      getDeployedEcsImage(credentials, 'shop-cluster', 'auth-service'),
    ).resolves.toBeUndefined();

    mockSend.mockResolvedValueOnce({
      services: [
        {
          serviceName: 'auth-service',
          status: 'INACTIVE',
          taskDefinition: 'x',
        },
      ],
    });
    await expect(
      getDeployedEcsImage(credentials, 'shop-cluster', 'auth-service'),
    ).resolves.toBeUndefined();
  });

  it("should count Terraform's first definition (:latest) as never deployed", async () => {
    mockSend
      .mockResolvedValueOnce({
        services: [
          {
            serviceName: 'auth-service',
            status: 'ACTIVE',
            taskDefinition: 'x',
          },
        ],
      })
      .mockResolvedValueOnce({
        taskDefinition: {
          containerDefinitions: [{ image: 'repo/auth-service:latest' }],
        },
      });

    await expect(
      getDeployedEcsImage(credentials, 'shop-cluster', 'auth-service'),
    ).resolves.toBeUndefined();
  });
});
