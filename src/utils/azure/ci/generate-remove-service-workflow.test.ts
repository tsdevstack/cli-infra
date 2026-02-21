import { describe, it, expect } from '@rstest/core';
import { generateRemoveServiceWorkflow } from './generate-remove-service-workflow';
import type { CIConfig } from './types';

describe('generateRemoveServiceWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  it('should return a string', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(typeof result).toBe('string');
  });

  it('should be named Remove Service', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('name: Remove Service');
  });

  it('should include environment choice', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev', 'prod']));
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should require service name input', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('service_name:');
    expect(result).toContain('required: true');
  });

  it('should require confirmation input', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('confirm:');
    expect(result).toContain('Type service name again to confirm');
  });

  it('should have dry run option', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('dry_run:');
    expect(result).toContain('default: false');
  });

  it('should validate confirmation matches service name', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('Validate confirmation');
  });

  it('should authenticate to Azure via OIDC', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('azure/login@v2');
    expect(result).toContain('client-id');
  });

  it('should set ARM environment variables for Terraform OIDC', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('ARM_USE_OIDC=true');
  });

  it('should run remove-service command', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('infra:remove-service');
    expect(result).toContain('--confirm');
  });

  it('should include GitHub Step Summary', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('GITHUB_STEP_SUMMARY');
    expect(result).toContain('Service Removed');
  });

  it('should use build:libs not full build', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).toContain('npm run build:libs');
  });

  it('should not use AWS or GCP auth', () => {
    const result = generateRemoveServiceWorkflow(createConfig(['dev']));
    expect(result).not.toContain('aws-actions');
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
    expect(result).not.toContain('AWS_ROLE_ARN');
  });
});
