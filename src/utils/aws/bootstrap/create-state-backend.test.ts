import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';

interface MockCommand {
  type: string;
  input: Record<string, unknown>;
}

const s3Errors: Record<string, { name: string } | undefined> = {};
const mockS3Send = rs.fn(async (command: MockCommand) => {
  const error = s3Errors[command.type];
  if (error) {
    throw Object.assign(new Error(error.name), error);
  }
  return {};
});
const mockDynamoSend = rs.fn(async () => ({
  Table: { TableStatus: 'ACTIVE' },
}));

function command(type: string) {
  return rs.fn().mockImplementation(function (input: Record<string, unknown>) {
    return { type, input };
  });
}

rs.mock('@aws-sdk/client-s3', () => ({
  S3Client: rs.fn().mockImplementation(function () {
    return { send: mockS3Send };
  }),
  HeadBucketCommand: command('HeadBucket'),
  CreateBucketCommand: command('CreateBucket'),
  PutBucketVersioningCommand: command('PutBucketVersioning'),
  PutPublicAccessBlockCommand: command('PutPublicAccessBlock'),
  GetBucketPolicyCommand: command('GetBucketPolicy'),
  PutBucketPolicyCommand: command('PutBucketPolicy'),
}));

rs.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: rs.fn().mockImplementation(function () {
    return { send: mockDynamoSend };
  }),
  DescribeTableCommand: command('DescribeTable'),
  CreateTableCommand: command('CreateTable'),
}));

rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-central-1' })),
}));

import { createStateBackend } from './create-state-backend';

const OPTIONS = {
  projectName: 'shop',
  accountId: '123456789012',
  credentials: { region: 'eu-central-1' } as AWSCredentials,
};

function sent(type: string): MockCommand[] {
  return mockS3Send.mock.calls.map(([c]) => c).filter((c) => c.type === type);
}

describe('createStateBackend', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    for (const key of Object.keys(s3Errors)) {
      delete s3Errors[key];
    }
  });

  describe('Standard use cases', () => {
    it('should create a new bucket private, versioned and refusing requests without HTTPS', async () => {
      s3Errors.HeadBucket = { name: 'NotFound' };
      s3Errors.GetBucketPolicy = { name: 'NoSuchBucketPolicy' };

      const result = await createStateBackend(OPTIONS);

      expect(sent('CreateBucket')[0].input).toEqual({
        Bucket: 'shop-terraform-state-123456789012',
        CreateBucketConfiguration: { LocationConstraint: 'eu-central-1' },
      });
      expect(sent('PutBucketVersioning')).toHaveLength(1);
      expect(sent('PutPublicAccessBlock')).toHaveLength(1);
      const policy = JSON.parse(
        sent('PutBucketPolicy')[0].input.Policy as string,
      ) as { Statement: { Sid: string }[] };
      expect(policy.Statement[0].Sid).toBe('DenyInsecureTransport');
      expect(result).toMatchObject({
        success: true,
        bucketCreated: true,
        bucketPolicySet: true,
      });
    });

    it('should add the policy to an older bucket that has none', async () => {
      s3Errors.GetBucketPolicy = { name: 'NoSuchBucketPolicy' };

      const result = await createStateBackend(OPTIONS);

      expect(sent('CreateBucket')).toHaveLength(0);
      expect(sent('PutBucketPolicy')).toHaveLength(1);
      expect(result).toMatchObject({
        success: true,
        bucketCreated: false,
        bucketPolicySet: true,
      });
    });
  });

  describe('Edge cases', () => {
    it('should leave a policy someone already set alone', async () => {
      const result = await createStateBackend(OPTIONS);

      expect(sent('GetBucketPolicy')).toHaveLength(1);
      expect(sent('PutBucketPolicy')).toHaveLength(0);
      expect(result).toMatchObject({ success: true, bucketPolicySet: false });
    });

    it('should fail when the policy cannot be read', async () => {
      s3Errors.GetBucketPolicy = { name: 'AccessDenied' };

      const result = await createStateBackend(OPTIONS);

      expect(sent('PutBucketPolicy')).toHaveLength(0);
      expect(result).toMatchObject({
        success: false,
        bucketPolicySet: false,
        error: 'AccessDenied',
      });
    });
  });
});
