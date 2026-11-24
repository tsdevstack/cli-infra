import { describe, it, expect, rs, beforeEach, afterEach } from '@rstest/core';
import type { MockContext } from '@tsdevstack/cli/test-utils';

const mocks = (globalThis as unknown as { contextMocks: MockContext })
  .contextMocks;

rs.mock('../../../context', () => ({
  getContext: rs.fn(
    () => (globalThis as unknown as { contextMocks: MockContext }).contextMocks,
  ),
}));

const mockGetSchedule = rs.fn();
rs.mock('./get-aws-schedule', () => ({
  getAwsSchedule: (...args: unknown[]) => mockGetSchedule(...args),
}));

const mockInvoke = rs.fn();
rs.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class {
    send = mockInvoke;
  },
  InvokeCommand: class {
    constructor(public input: { Payload: Uint8Array }) {}
  },
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: rs.fn(() => ({ region: 'eu-west-1' })),
}));

import { runAwsTriggerNow } from './run-aws-trigger-now';

const ctx = {
  projectRoot: '/project',
  projectName: 'shop',
  targetEnv: 'dev',
  credentials: {
    region: 'eu-west-1',
    accessKeyId: 'k',
    secretAccessKey: 's',
    accountId: '123456789012',
  },
  runningInCI: false,
};
const trigger = {
  name: 'cleanup-tokens',
  schedule: '0 3 * * *',
  targetService: 'auth-service',
  endpoint: '/auth/jobs/cleanup-tokens',
};
const functionArn =
  'arn:aws:lambda:eu-west-1:123456789012:function:shop-job-invoker';
// The event as Terraform wrote it into the schedule (jsonencode)
const input =
  '{"jobName":"auth-service-cleanup-tokens","method":"POST","path":"/auth/jobs/cleanup-tokens","serviceName":"auth-service","timeoutSeconds":300}';
const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));
const logResult = (text: string): string =>
  Buffer.from(text).toString('base64');

describe('runAwsTriggerNow', () => {
  beforeEach(() => {
    rs.clearAllMocks();
    process.exitCode = undefined;
    mockGetSchedule.mockResolvedValue({
      Target: { Arn: functionArn, Input: input },
    });
    mockInvoke.mockResolvedValue({
      StatusCode: 200,
      Payload: encode({ statusCode: 200, body: '{"deleted":3}' }),
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('should invoke the job function with the event its schedule sends, and wait for the answer', async () => {
    await runAwsTriggerNow(ctx, trigger);

    expect(mockGetSchedule).toHaveBeenCalledWith(
      ctx.credentials,
      'shop-auth-service-cleanup-tokens',
    );
    const command = mockInvoke.mock.calls[0][0] as {
      input: Record<string, unknown> & { Payload: Uint8Array };
    };
    expect(command.input).toMatchObject({
      FunctionName: functionArn,
      InvocationType: 'RequestResponse',
      LogType: 'Tail',
    });
    expect(new TextDecoder().decode(command.input.Payload)).toBe(input);
    expect(mocks.logger.success).toHaveBeenCalledWith(
      '"cleanup-tokens" finished: 200 from auth-service/auth/jobs/cleanup-tokens',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith('Response: {"deleted":3}');
    expect(process.exitCode).toBeUndefined();
  });

  it("should report the job function's own error and its log, with exit code 1", async () => {
    mockInvoke.mockResolvedValue({
      StatusCode: 200,
      FunctionError: 'Unhandled',
      Payload: encode({
        errorType: 'Error',
        errorMessage: 'Job failed with status 500',
      }),
      LogResult: logResult(
        'job=auth-service-cleanup-tokens Run finished: 500 (boom)',
      ),
    });

    await runAwsTriggerNow(ctx, trigger);

    expect(mocks.logger.error).toHaveBeenCalledWith(
      '"cleanup-tokens" failed: Job failed with status 500',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'job=auth-service-cleanup-tokens Run finished: 500 (boom)',
    );
    expect(process.exitCode).toBe(1);
  });

  it("should leave the function's log out with lines false", async () => {
    mockInvoke.mockResolvedValue({
      StatusCode: 200,
      FunctionError: 'Unhandled',
      Payload: encode({
        errorType: 'Error',
        errorMessage: 'Job failed with status 500',
      }),
      LogResult: logResult(
        'job=auth-service-cleanup-tokens Run finished: 500 (boom)',
      ),
    });

    await runAwsTriggerNow(ctx, trigger, { lines: false });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      '"cleanup-tokens" failed: Job failed with status 500',
    );
    expect(mocks.logger.info).not.toHaveBeenCalledWith(
      'job=auth-service-cleanup-tokens Run finished: 500 (boom)',
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Log: npx tsdevstack infra:logs cleanup-tokens --env dev',
    );
    expect(process.exitCode).toBe(1);
  });

  it('should count a refusal the function answers as a failure', async () => {
    mockInvoke.mockResolvedValue({
      StatusCode: 200,
      Payload: encode({
        statusCode: 400,
        body: '{"error":"Missing serviceName or path"}',
      }),
    });

    await runAwsTriggerNow(ctx, trigger);

    expect(mocks.logger.error).toHaveBeenCalledWith(
      '"cleanup-tokens" failed: 400 ({"error":"Missing serviceName or path"})',
    );
    expect(process.exitCode).toBe(1);
  });

  it('should show the deploy hint when the schedule does not exist', async () => {
    mockGetSchedule.mockResolvedValue(undefined);

    await expect(runAwsTriggerNow(ctx, trigger)).rejects.toMatchObject({
      message:
        '"cleanup-tokens" is not deployed in dev (no schedule shop-auth-service-cleanup-tokens)',
      hint: 'Deploy it first: npx tsdevstack infra:deploy-schedulers --env dev',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('should show the deploy hint when the job function does not exist', async () => {
    mockInvoke.mockRejectedValue(
      Object.assign(new Error('Function not found'), {
        name: 'ResourceNotFoundException',
      }),
    );

    await expect(runAwsTriggerNow(ctx, trigger)).rejects.toMatchObject({
      message:
        '"cleanup-tokens" is not deployed in dev (no function shop-job-invoker)',
      hint: 'Deploy it first: npx tsdevstack infra:deploy-schedulers --env dev',
    });
  });

  it("should pass any other refused invoke on with AWS's reason", async () => {
    mockInvoke.mockRejectedValue(
      new Error('AccessDeniedException: lambda:InvokeFunction'),
    );

    await expect(runAwsTriggerNow(ctx, trigger)).rejects.toMatchObject({
      message:
        'Could not run "cleanup-tokens": AccessDeniedException: lambda:InvokeFunction',
      hint: 'Log: npx tsdevstack infra:logs cleanup-tokens --env dev',
    });
  });

  it('should refuse a schedule that calls no job function', async () => {
    mockGetSchedule.mockResolvedValue({
      Target: { Arn: 'arn:aws:ecs:eu-west-1:123456789012:cluster/shop' },
    });

    await expect(runAwsTriggerNow(ctx, trigger)).rejects.toMatchObject({
      message:
        'The schedule shop-auth-service-cleanup-tokens calls no job function',
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
