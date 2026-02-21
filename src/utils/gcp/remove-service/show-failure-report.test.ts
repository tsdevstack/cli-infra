import { describe, it, expect, rs } from '@rstest/core';
import { showFailureReport } from './show-failure-report';
import type { DeletionStep } from './types';

describe('showFailureReport', () => {
  const createMockLogger = () => ({
    newline: rs.fn(),
    error: rs.fn(),
    success: rs.fn(),
    info: rs.fn(),
  });

  const createStep = (name: string, resource: string): DeletionStep => ({
    name,
    resource,
    execute: rs.fn().mockResolvedValue({ success: true, deleted: true }),
  });

  it('should show failed step name', () => {
    const logger = createMockLogger();
    const failed = createStep('Database', 'my-database');

    showFailureReport(logger, [], failed, []);

    expect(logger.error).toHaveBeenCalledWith('Failed at: Database');
  });

  it('should show completed steps when present', () => {
    const logger = createMockLogger();
    const completed = [
      createStep('Cloud Run', 'my-service'),
      createStep('Bucket', 'my-bucket'),
    ];
    const failed = createStep('Database', 'my-database');

    showFailureReport(logger, completed, failed, []);

    expect(logger.success).toHaveBeenCalledWith('Already deleted:');
    expect(logger.info).toHaveBeenCalledWith('   - Cloud Run: my-service');
    expect(logger.info).toHaveBeenCalledWith('   - Bucket: my-bucket');
  });

  it('should not show completed section when empty', () => {
    const logger = createMockLogger();
    const failed = createStep('Database', 'my-database');

    showFailureReport(logger, [], failed, []);

    expect(logger.success).not.toHaveBeenCalledWith('Already deleted:');
  });

  it('should show failed step in not yet deleted section', () => {
    const logger = createMockLogger();
    const failed = createStep('Database', 'my-database');

    showFailureReport(logger, [], failed, []);

    expect(logger.info).toHaveBeenCalledWith('Not yet deleted:');
    expect(logger.info).toHaveBeenCalledWith(
      '   - Database: my-database (failed)',
    );
  });

  it('should show remaining steps', () => {
    const logger = createMockLogger();
    const failed = createStep('Database', 'my-database');
    const remaining = [
      createStep('Service Account', 'sa@project.iam'),
      createStep('Secrets', '5 secrets'),
    ];

    showFailureReport(logger, [], failed, remaining);

    expect(logger.info).toHaveBeenCalledWith(
      '   - Service Account: sa@project.iam',
    );
    expect(logger.info).toHaveBeenCalledWith('   - Secrets: 5 secrets');
  });

  it('should show retry instructions', () => {
    const logger = createMockLogger();
    const failed = createStep('Database', 'my-database');

    showFailureReport(logger, [], failed, []);

    expect(logger.info).toHaveBeenCalledWith(
      'Re-run the command to retry (deletes are idempotent).',
    );
  });

  it('should add proper spacing with newlines', () => {
    const logger = createMockLogger();
    const failed = createStep('Database', 'my-database');

    showFailureReport(logger, [], failed, []);

    // Should have newlines for proper spacing
    expect(logger.newline).toHaveBeenCalled();
  });
});
