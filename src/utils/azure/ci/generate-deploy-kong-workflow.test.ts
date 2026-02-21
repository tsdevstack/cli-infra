import { describe, it, expect } from '@rstest/core';
import { generateDeployKongWorkflow } from './generate-deploy-kong-workflow';
import type { CIConfig } from './types';

describe('generateDeployKongWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  it('should return a string', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(typeof result).toBe('string');
  });

  it('should be named Deploy Kong Gateway', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('name: Deploy Kong Gateway');
  });

  it('should include environment choice', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev', 'prod']));
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should include optional tag input', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('tag:');
    expect(result).toContain('required: false');
  });

  it('should authenticate to Azure via OIDC', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('azure/login@v2');
    expect(result).toContain('client-id');
  });

  it('should set ARM environment variables for Terraform OIDC', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('ARM_USE_OIDC=true');
  });

  it('should setup Terraform (Azure divergence from AWS)', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('hashicorp/setup-terraform@v3');
  });

  it('should initialize Terraform (Azure divergence from AWS)', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('terraform init');
  });

  it('should enable containerd', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('containerd-snapshotter');
  });

  it('should build and deploy Kong', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('infra:build-kong');
    expect(result).toContain('infra:deploy-kong');
  });

  it('should not use --auto-approve (deploy-kong does not accept it)', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).not.toContain('--auto-approve');
  });

  it('should use full build (not build:libs)', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).toContain('run: npm run build');
    expect(result).not.toContain('build:libs');
  });

  it('should not use AWS or GCP auth', () => {
    const result = generateDeployKongWorkflow(createConfig(['dev']));
    expect(result).not.toContain('aws-actions');
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
    expect(result).not.toContain('AWS_ROLE_ARN');
  });
});
