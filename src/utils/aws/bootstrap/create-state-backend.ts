/**
 * Create AWS Terraform State Backend
 *
 * Creates S3 bucket + DynamoDB table for Terraform state management.
 * Unlike GCP (single bucket with built-in locking), AWS requires both.
 */

import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
} from '@aws-sdk/client-s3';
import type { BucketLocationConstraint } from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';

export interface CreateStateBackendOptions {
  projectName: string;
  accountId: string;
  credentials: AWSCredentials;
}

export interface CreateStateBackendResult {
  success: boolean;
  bucketName: string;
  tableName: string;
  bucketCreated: boolean;
  tableCreated: boolean;
  error?: string;
}

/**
 * Create S3 bucket and DynamoDB table for Terraform state
 */
export async function createStateBackend(
  options: CreateStateBackendOptions,
): Promise<CreateStateBackendResult> {
  const { projectName, accountId, credentials } = options;

  const bucketName = `${projectName}-terraform-state-${accountId}`;
  const tableName = `${projectName}-terraform-locks`;

  const clientConfig = buildAWSClientConfig(credentials);
  const s3 = new S3Client(clientConfig);
  const dynamodb = new DynamoDBClient(clientConfig);

  let bucketCreated = false;
  let tableCreated = false;

  try {
    // Check if bucket exists
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error.name === 'NotFound' || error.name === 'NoSuchBucket') {
        // Create bucket
        const createBucketInput: {
          Bucket: string;
          CreateBucketConfiguration?: {
            LocationConstraint: BucketLocationConstraint;
          };
        } = {
          Bucket: bucketName,
        };

        // us-east-1 doesn't accept LocationConstraint
        if (credentials.region !== 'us-east-1') {
          createBucketInput.CreateBucketConfiguration = {
            LocationConstraint: credentials.region as BucketLocationConstraint,
          };
        }

        await s3.send(new CreateBucketCommand(createBucketInput));
        bucketCreated = true;

        // Enable versioning
        await s3.send(
          new PutBucketVersioningCommand({
            Bucket: bucketName,
            VersioningConfiguration: { Status: 'Enabled' },
          }),
        );

        // Block public access
        await s3.send(
          new PutPublicAccessBlockCommand({
            Bucket: bucketName,
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              BlockPublicPolicy: true,
              IgnorePublicAcls: true,
              RestrictPublicBuckets: true,
            },
          }),
        );
      } else {
        throw err;
      }
    }

    // Check if DynamoDB table exists
    try {
      await dynamodb.send(new DescribeTableCommand({ TableName: tableName }));
    } catch (err: unknown) {
      const error = err as { name?: string };
      if (error.name === 'ResourceNotFoundException') {
        // Create table
        await dynamodb.send(
          new CreateTableCommand({
            TableName: tableName,
            BillingMode: 'PAY_PER_REQUEST',
            KeySchema: [{ AttributeName: 'LockID', KeyType: 'HASH' }],
            AttributeDefinitions: [
              { AttributeName: 'LockID', AttributeType: 'S' },
            ],
          }),
        );

        // Wait for table to become ACTIVE before Terraform tries to use it
        let status = 'CREATING';
        while (status !== 'ACTIVE') {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const desc = await dynamodb.send(
            new DescribeTableCommand({ TableName: tableName }),
          );
          status = desc.Table?.TableStatus ?? 'CREATING';
        }

        tableCreated = true;
      } else {
        throw err;
      }
    }

    return {
      success: true,
      bucketName,
      tableName,
      bucketCreated,
      tableCreated,
    };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      success: false,
      bucketName,
      tableName,
      bucketCreated,
      tableCreated,
      error: error.message || 'Unknown error',
    };
  }
}
