import { describe, it, expect, rs, beforeEach } from '@rstest/core';

const { mockSend } = rs.hoisted(() => ({ mockSend: rs.fn() }));

rs.mock('@aws-sdk/client-cloudwatch-logs', () => ({
  CloudWatchLogsClient: class {
    send = mockSend;
  },
  GetLogEventsCommand: class {
    constructor(public input: unknown) {}
  },
}));
rs.mock('../build-aws-client-config', () => ({
  buildAWSClientConfig: () => ({ region: 'eu-west-1' }),
}));

import { readDbInitLogTail } from './read-db-init-log-tail';

const options = {
  projectName: 'shop',
  taskArn: 'arn:aws:ecs:eu-west-1:123456789012:task/shop-cluster/abc123',
  credentials: {} as never,
};

describe('readDbInitLogTail', () => {
  beforeEach(() => {
    rs.clearAllMocks();
  });

  describe('Standard use cases', () => {
    it("should read the end of the task's own log stream", async () => {
      mockSend.mockResolvedValue({
        events: [
          { message: 'db-init starting (export)...' },
          { message: 'db-init failed: No database auth-service\n' },
        ],
      });

      expect(await readDbInitLogTail(options)).toBe(
        'db-init starting (export)...\ndb-init failed: No database auth-service',
      );
      expect(mockSend.mock.calls[0][0].input).toEqual({
        logGroupName: '/ecs/shop/db-init',
        logStreamName: 'db-init/db-init/abc123',
        startFromHead: false,
        limit: 50,
      });
    });
  });

  describe('Edge cases', () => {
    it('should give null when the log is empty', async () => {
      mockSend.mockResolvedValue({ events: [] });
      expect(await readDbInitLogTail(options)).toBeNull();
    });

    it("should give null when the log can't be read", async () => {
      mockSend.mockRejectedValue(new Error('ResourceNotFoundException'));
      expect(await readDbInitLogTail(options)).toBeNull();
    });
  });
});
