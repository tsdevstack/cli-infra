/**
 * Describe a stopped ECS task as a platform line: why it stopped and how
 * its containers exited. A task that failed to start or whose container
 * crashed is an error; failed health checks are a warning; a deploy or a
 * scale-in replacing it, or a migration ending with exit code 0, is info.
 */

import type { Task } from '@aws-sdk/client-ecs';
import type { LogLevel } from '../../logs/types';

export function formatAwsStoppedTask(task: Task): {
  level: LogLevel;
  message: string;
} {
  const taskId = (task.taskArn ?? '').split('/').pop()?.slice(0, 8) ?? '';
  const reason = task.stoppedReason ?? task.stopCode ?? 'no reason given';

  const exits = (task.containers ?? [])
    .filter((container) => container.exitCode !== undefined || container.reason)
    .map((container) => {
      const exit =
        container.exitCode !== undefined ? ` exit ${container.exitCode}` : '';
      const why = container.reason ? ` (${container.reason})` : '';
      return `${container.name ?? 'container'}${exit}${why}`;
    });

  const crashed =
    task.stopCode === 'EssentialContainerExited' &&
    (task.containers ?? []).some(
      (container) =>
        typeof container.exitCode === 'number' && container.exitCode !== 0,
    );

  let level: LogLevel = 'info';
  if (task.stopCode === 'TaskFailedToStart' || crashed) {
    level = 'error';
  } else if (/health/i.test(reason)) {
    level = 'warn';
  }

  return {
    level,
    message: `Task ${taskId} stopped: ${reason}${exits.length > 0 ? `; ${exits.join(', ')}` : ''}`,
  };
}
