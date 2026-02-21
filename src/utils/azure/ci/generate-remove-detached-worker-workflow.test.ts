import { describe, it, expect } from '@rstest/core';
import { generateRemoveDetachedWorkerWorkflow } from './generate-remove-detached-worker-workflow';
import type { CIConfig } from './types';

describe('generateRemoveDetachedWorkerWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  it('should return a string', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(typeof result).toBe('string');
  });

  it('should be named Remove Detached Worker', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('name: Remove Detached Worker');
  });

  it('should include environment choice', () => {
    const result = generateRemoveDetachedWorkerWorkflow(
      createConfig(['dev', 'prod']),
    );
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should require worker name input', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('worker_name:');
    expect(result).toContain('required: true');
  });

  it('should require confirmation input', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('confirm:');
    expect(result).toContain('Type worker name again to confirm');
  });

  it('should validate confirmation matches worker name', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('Validate confirmation');
  });

  it('should authenticate to Azure via OIDC', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('azure/login@v2');
    expect(result).toContain('client-id');
  });

  it('should set ARM environment variables for Terraform OIDC', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('ARM_USE_OIDC=true');
  });

  it('should run remove-detached-worker command', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('infra:remove-detached-worker');
    expect(result).toContain('--confirm');
  });

  it('should include GitHub Step Summary', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('GITHUB_STEP_SUMMARY');
    expect(result).toContain('Worker Removed');
  });

  it('should use build:libs not full build', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('npm run build:libs');
  });

  it('should setup Terraform', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).toContain('hashicorp/setup-terraform@v3');
    expect(result).toContain('terraform_version');
  });

  it('should not use AWS or GCP auth', () => {
    const result = generateRemoveDetachedWorkerWorkflow(createConfig(['dev']));
    expect(result).not.toContain('aws-actions');
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
    expect(result).not.toContain('AWS_ROLE_ARN');
  });
});
