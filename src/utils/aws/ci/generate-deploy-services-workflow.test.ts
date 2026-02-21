import { describe, it, expect } from '@rstest/core';
import { generateDeployServicesWorkflow } from './generate-deploy-services-workflow';
import type { CIConfig } from './types';

describe('generateDeployServicesWorkflow', () => {
  const createConfig = (environments: string[]): CIConfig => ({
    provider: 'github',
    environments,
  });

  const defaultServices = [
    { name: 'auth-service', type: 'nestjs' },
    { name: 'frontend', type: 'nextjs' },
  ];

  it('should return a string', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(typeof result).toBe('string');
  });

  it('should be named Deploy Services', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('name: Deploy Services');
  });

  it('should include environment choice', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev', 'prod']),
      defaultServices,
    );
    expect(result).toContain('- dev');
    expect(result).toContain('- prod');
  });

  it('should generate boolean inputs for each service', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('auth_service:');
    expect(result).toContain("description: 'Deploy auth-service'");
    expect(result).toContain('frontend:');
    expect(result).toContain("description: 'Deploy frontend'");
  });

  it('should filter to deployable services only', () => {
    const services = [
      { name: 'auth-service', type: 'nestjs' },
      { name: 'frontend', type: 'nextjs' },
      { name: 'static-site', type: 'spa' },
      { name: 'shared-lib', type: 'library' },
    ];
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      services,
    );
    expect(result).toContain('auth_service:');
    expect(result).toContain('frontend:');
    expect(result).toContain('static_site:');
    expect(result).not.toContain('shared_lib:');
  });

  it('should authenticate to AWS via OIDC', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('aws-actions/configure-aws-credentials@v4');
    expect(result).toContain('role-to-assume');
  });

  it('should login to ECR', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('aws-actions/amazon-ecr-login@v2');
  });

  it('should initialize Terraform without backend-config credentials', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('terraform init');
    expect(result).not.toContain('backend-config');
    expect(result).not.toContain('GOOGLE_APPLICATION_CREDENTIALS');
  });

  it('should deploy selected services with single CSV call', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('infra:deploy-services');
    expect(result).toContain('SERVICES_CSV=$(echo $SERVICES');
    expect(result).toContain('--service "$SERVICES_CSV"');
  });

  it('should use dynamic AWS secret lookup pattern', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('AWS_ROLE_ARN_NAME=AWS_ROLE_ARN_');
    expect(result).toContain('AWS_REGION_NAME=AWS_REGION_');
  });

  it('should not use GCP-specific services', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
    expect(result).not.toContain('GCP_WIF');
  });
});
