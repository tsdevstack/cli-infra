import { describe, it, expect } from '@rstest/core';
import { generateDeployScheduledJobsWorkflow } from './generate-deploy-scheduled-jobs-workflow';
import type { CIConfig } from './types';

describe('generateDeployScheduledJobsWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  it('should return a string', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(typeof result).toBe('string');
  });

  it('should be named Deploy Scheduled Jobs', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).toContain('name: Deploy Scheduled Jobs');
  });

  it('should include environment choice', () => {
    const result = generateDeployScheduledJobsWorkflow(
      createConfig(['dev', 'prod']),
    );
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should authenticate to AWS via OIDC', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).toContain('aws-actions/configure-aws-credentials@v4');
    expect(result).toContain('role-to-assume');
  });

  it('should use build:libs not full build', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).toContain('npm run build:libs');
  });

  it('should setup Terraform', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).toContain('hashicorp/setup-terraform@v3');
  });

  it('should deploy schedulers with auto-approve', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).toContain('infra:deploy-schedulers');
    expect(result).toContain('--auto-approve');
  });

  it('should not include Docker or ECR steps', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).not.toContain('amazon-ecr-login');
    expect(result).not.toContain('containerd');
  });

  it('should not use GCP-specific services', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
  });
});
