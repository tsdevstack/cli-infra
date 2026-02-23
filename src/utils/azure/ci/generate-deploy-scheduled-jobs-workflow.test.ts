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
    expect(result).toContain('name: "Deploy Scheduled Jobs');
  });

  it('should include environment choice', () => {
    const result = generateDeployScheduledJobsWorkflow(
      createConfig(['dev', 'prod']),
    );
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should authenticate to Azure via OIDC', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).toContain('azure/login@v2');
    expect(result).toContain('client-id');
  });

  it('should set ARM environment variables for Terraform OIDC', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).toContain('ARM_USE_OIDC=true');
  });

  it('should use build:libs not full build in framework mode', () => {
    const result = generateDeployScheduledJobsWorkflow(
      createConfig(['dev']),
      'framework',
    );
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

  it('should not include Docker steps', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).not.toContain('containerd');
  });

  it('should not use AWS or GCP auth', () => {
    const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
    expect(result).not.toContain('aws-actions');
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
    expect(result).not.toContain('AWS_ROLE_ARN');
  });

  describe('user mode (default)', () => {
    it('should use npx tsdevstack', () => {
      const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
      expect(result).toContain('npx tsdevstack');
      expect(result).not.toContain('node packages/cli-core/dist/cli.js');
      expect(result).not.toContain('npm link');
    });

    it('should not include build steps', () => {
      const result = generateDeployScheduledJobsWorkflow(createConfig(['dev']));
      expect(result).not.toContain('build:libs');
    });
  });

  describe('framework mode', () => {
    it('should use node packages/cli-core/dist/cli.js', () => {
      const result = generateDeployScheduledJobsWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('node packages/cli-core/dist/cli.js');
      expect(result).not.toContain('npx tsdevstack');
    });

    it('should include npm link', () => {
      const result = generateDeployScheduledJobsWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('npm link');
    });

    it('should have Framework workflow name', () => {
      const result = generateDeployScheduledJobsWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('name: "Framework: Deploy Scheduled Jobs');
    });

    it('should have framework header comment', () => {
      const result = generateDeployScheduledJobsWorkflow(
        createConfig(['dev']),
        'framework',
      );
      expect(result).toContain('Framework development workflow');
    });
  });
});
