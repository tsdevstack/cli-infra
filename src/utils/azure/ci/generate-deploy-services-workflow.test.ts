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
    expect(result).toContain('name: "Deploy Services');
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

  it('should authenticate to Azure via OIDC', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('azure/login@v2');
    expect(result).toContain('client-id');
  });

  it('should set ARM environment variables for Terraform OIDC', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('ARM_USE_OIDC=true');
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

  it('should use dynamic Azure secret lookup pattern', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).toContain('AZURE_CLIENT_ID_NAME=AZURE_CLIENT_ID_');
    expect(result).toContain('AZURE_TENANT_ID_NAME=AZURE_TENANT_ID_');
  });

  it('should not use AWS or GCP auth', () => {
    const result = generateDeployServicesWorkflow(
      createConfig(['dev']),
      defaultServices,
    );
    expect(result).not.toContain('aws-actions');
    expect(result).not.toContain('google-github-actions');
    expect(result).not.toContain('gcloud');
    expect(result).not.toContain('GCP_WIF');
    expect(result).not.toContain('AWS_ROLE_ARN');
  });

  describe('user mode (default)', () => {
    it('should use npx tsdevstack', () => {
      const result = generateDeployServicesWorkflow(
        createConfig(['dev']),
        defaultServices,
      );
      expect(result).toContain('npx tsdevstack');
      expect(result).not.toContain('node packages/cli-core/dist/cli.js');
      expect(result).not.toContain('npm link');
    });

    it('should include npm run build', () => {
      const result = generateDeployServicesWorkflow(
        createConfig(['dev']),
        defaultServices,
      );
      expect(result).toContain('npm run build');
    });
  });

  describe('framework mode', () => {
    it('should use node packages/cli-core/dist/cli.js', () => {
      const result = generateDeployServicesWorkflow(
        createConfig(['dev']),
        defaultServices,
        'framework',
      );
      expect(result).toContain('node packages/cli-core/dist/cli.js');
      expect(result).not.toContain('npx tsdevstack');
    });

    it('should include npm link', () => {
      const result = generateDeployServicesWorkflow(
        createConfig(['dev']),
        defaultServices,
        'framework',
      );
      expect(result).toContain('npm link');
    });

    it('should have Framework workflow name', () => {
      const result = generateDeployServicesWorkflow(
        createConfig(['dev']),
        defaultServices,
        'framework',
      );
      expect(result).toContain('name: "Framework: Deploy Services');
    });

    it('should have framework header comment', () => {
      const result = generateDeployServicesWorkflow(
        createConfig(['dev']),
        defaultServices,
        'framework',
      );
      expect(result).toContain('Framework development workflow');
    });
  });
});
