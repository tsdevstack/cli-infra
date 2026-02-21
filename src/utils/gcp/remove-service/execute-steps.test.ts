import { describe, it, expect, rs } from '@rstest/core';
import { executeSteps } from './execute-steps';
import type { DeletionStep } from './types';

describe('executeSteps', () => {
  const createMockLogger = () => ({
    info: rs.fn(),
    success: rs.fn(),
    error: rs.fn(),
  });

  const createStep = (
    name: string,
    result: { success: boolean; deleted: boolean; error?: string },
  ): DeletionStep => ({
    name,
    resource: `${name}-resource`,
    execute: rs.fn().mockResolvedValue(result),
  });

  it('should return all steps as completed when all succeed', async () => {
    const logger = createMockLogger();
    const steps = [
      createStep('Step 1', { success: true, deleted: true }),
      createStep('Step 2', { success: true, deleted: true }),
      createStep('Step 3', { success: true, deleted: true }),
    ];

    const result = await executeSteps(logger, steps);

    expect(result.completed).toHaveLength(3);
    expect(result.failed).toBeNull();
    expect(result.remaining).toHaveLength(0);
  });

  it('should stop at first failure and return remaining steps', async () => {
    const logger = createMockLogger();
    const steps = [
      createStep('Step 1', { success: true, deleted: true }),
      createStep('Step 2', { success: false, deleted: false, error: 'Failed' }),
      createStep('Step 3', { success: true, deleted: true }),
    ];

    const result = await executeSteps(logger, steps);

    expect(result.completed).toHaveLength(1);
    expect(result.failed).toBe(steps[1]);
    expect(result.remaining).toHaveLength(1);
    expect(result.remaining[0]).toBe(steps[2]);
  });

  it('should handle thrown errors as failures', async () => {
    const logger = createMockLogger();
    const throwingStep: DeletionStep = {
      name: 'Throwing step',
      resource: 'test',
      execute: rs.fn().mockRejectedValue(new Error('Network error')),
    };
    const steps = [
      createStep('Step 1', { success: true, deleted: true }),
      throwingStep,
      createStep('Step 3', { success: true, deleted: true }),
    ];

    const result = await executeSteps(logger, steps);

    expect(result.completed).toHaveLength(1);
    expect(result.failed).toBe(throwingStep);
    expect(result.remaining).toHaveLength(1);
  });

  it('should log success message for deleted resources', async () => {
    const logger = createMockLogger();
    const steps = [createStep('Step 1', { success: true, deleted: true })];

    await executeSteps(logger, steps);

    expect(logger.success).toHaveBeenCalledWith('     ✔ Deleted');
  });

  it('should log "Already gone" for resources that were not found', async () => {
    const logger = createMockLogger();
    const steps = [createStep('Step 1', { success: true, deleted: false })];

    await executeSteps(logger, steps);

    expect(logger.info).toHaveBeenCalledWith('     ✔ Already gone');
  });

  it('should log error message on failure', async () => {
    const logger = createMockLogger();
    const steps = [
      createStep('Step 1', {
        success: false,
        deleted: false,
        error: 'Access denied',
      }),
    ];

    await executeSteps(logger, steps);

    expect(logger.error).toHaveBeenCalledWith('     Failed: Access denied');
  });

  it('should log step numbers during execution', async () => {
    const logger = createMockLogger();
    const steps = [
      createStep('First', { success: true, deleted: true }),
      createStep('Second', { success: true, deleted: true }),
    ];

    await executeSteps(logger, steps);

    expect(logger.info).toHaveBeenCalledWith('  1. Deleting First...');
    expect(logger.info).toHaveBeenCalledWith('  2. Deleting Second...');
  });

  it('should return empty arrays for empty input', async () => {
    const logger = createMockLogger();
    const result = await executeSteps(logger, []);

    expect(result.completed).toHaveLength(0);
    expect(result.failed).toBeNull();
    expect(result.remaining).toHaveLength(0);
  });

  it('should call execute on each step until failure', async () => {
    const logger = createMockLogger();
    const step1 = createStep('Step 1', { success: true, deleted: true });
    const step2 = createStep('Step 2', {
      success: false,
      deleted: false,
      error: 'Fail',
    });
    const step3 = createStep('Step 3', { success: true, deleted: true });

    await executeSteps(logger, [step1, step2, step3]);

    expect(step1.execute).toHaveBeenCalledTimes(1);
    expect(step2.execute).toHaveBeenCalledTimes(1);
    expect(step3.execute).not.toHaveBeenCalled();
  });
});
