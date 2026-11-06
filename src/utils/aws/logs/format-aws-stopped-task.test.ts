import { describe, it, expect } from '@rstest/core';
import { formatAwsStoppedTask } from './format-aws-stopped-task';

const ARN = 'arn:aws:ecs:eu-west-1:123:task/shop-cluster/0123456789abcdef';

describe('formatAwsStoppedTask', () => {
  describe('Standard use cases', () => {
    it('should report a crashed container as an error', () => {
      expect(
        formatAwsStoppedTask({
          taskArn: ARN,
          stopCode: 'EssentialContainerExited',
          stoppedReason: 'Essential container in task exited',
          containers: [{ name: 'auth-service', exitCode: 1 }],
        }),
      ).toEqual({
        level: 'error',
        message:
          'Task 01234567 stopped: Essential container in task exited; auth-service exit 1',
      });
    });

    it('should report a migration that ended well as info', () => {
      expect(
        formatAwsStoppedTask({
          taskArn: ARN,
          stopCode: 'EssentialContainerExited',
          stoppedReason: 'Essential container in task exited',
          containers: [{ name: 'migration', exitCode: 0 }],
        }).level,
      ).toBe('info');
    });

    it('should report a task that failed to start as an error, with the reason', () => {
      expect(
        formatAwsStoppedTask({
          taskArn: ARN,
          stopCode: 'TaskFailedToStart',
          stoppedReason: 'CannotPullContainerError: image not found',
          containers: [{ name: 'kong', reason: 'CannotPullContainerError' }],
        }),
      ).toEqual({
        level: 'error',
        message:
          'Task 01234567 stopped: CannotPullContainerError: image not found; kong (CannotPullContainerError)',
      });
    });
  });

  describe('Edge cases', () => {
    it('should warn about failed health checks', () => {
      expect(
        formatAwsStoppedTask({
          taskArn: ARN,
          stopCode: 'ServiceSchedulerInitiated',
          stoppedReason: 'Task failed ELB health checks in (target-group x)',
        }).level,
      ).toBe('warn');
    });

    it('should keep a deploy replacing a task at info, even with exit 143', () => {
      expect(
        formatAwsStoppedTask({
          taskArn: ARN,
          stopCode: 'ServiceSchedulerInitiated',
          stoppedReason: 'Scaling activity initiated by (deployment ecs-svc/1)',
          containers: [{ name: 'auth-service', exitCode: 143 }],
        }),
      ).toEqual({
        level: 'info',
        message:
          'Task 01234567 stopped: Scaling activity initiated by (deployment ecs-svc/1); auth-service exit 143',
      });
    });

    it('should still describe a task without details', () => {
      expect(formatAwsStoppedTask({})).toEqual({
        level: 'info',
        message: 'Task  stopped: no reason given',
      });
    });
  });
});
