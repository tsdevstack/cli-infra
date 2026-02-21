import { describe, it, expect, rs, beforeEach } from '@rstest/core';
import { printSetupInstructions } from './print-setup-instructions';

describe('printSetupInstructions', () => {
  const createMockLogger = () => ({
    info: rs.fn(),
    newline: rs.fn(),
    warn: rs.fn(),
  });

  beforeEach(() => {
    rs.clearAllMocks();
  });

  it('should print Azure OIDC setup section', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('Azure OIDC Setup');
    expect(infoCalls).toContain('App Registration');
  });

  it('should print federated credential setup', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('Federated Credential');
    expect(infoCalls).toContain('token.actions.githubusercontent.com');
    expect(infoCalls).toContain('api://AzureADTokenExchange');
    expect(infoCalls).toContain('YOUR_ORG/YOUR_REPO');
  });

  it('should print required roles', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('Contributor');
    expect(infoCalls).toContain('Key Vault Secrets Officer');
    expect(infoCalls).toContain('User Access Administrator');
  });

  it('should include troubleshooting section', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('Troubleshooting');
    expect(infoCalls).toContain('AADSTS700016');
    expect(infoCalls).toContain('id-token: write');
  });

  it('should note no client secret needed', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('No AZURE_CLIENT_SECRET needed');
    expect(infoCalls).toContain('DefaultAzureCredential');
  });

  it('should print GitHub secrets for each environment', () => {
    const logger = createMockLogger();
    printSetupInstructions([], 'myproject', ['dev', 'prod'], logger);

    const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
    expect(infoCalls).toContain('AZURE_CLIENT_ID_DEV');
    expect(infoCalls).toContain('AZURE_TENANT_ID_DEV');
    expect(infoCalls).toContain('AZURE_SUBSCRIPTION_ID_DEV');
    expect(infoCalls).toContain('AZURE_LOCATION_DEV');
    expect(infoCalls).toContain('AZURE_CLIENT_ID_PROD');
    expect(infoCalls).toContain('AZURE_TENANT_ID_PROD');
    expect(infoCalls).toContain('AZURE_SUBSCRIPTION_ID_PROD');
    expect(infoCalls).toContain('AZURE_LOCATION_PROD');
  });

  describe('user secrets section', () => {
    it('should show message when no user secrets', () => {
      const logger = createMockLogger();
      printSetupInstructions([], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('No user secrets found');
    });

    it('should list user secrets when provided', () => {
      const logger = createMockLogger();
      printSetupInstructions(
        ['API_KEY', 'STRIPE_SECRET'],
        'myproject',
        ['dev'],
        logger,
      );

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('- API_KEY');
      expect(infoCalls).toContain('- STRIPE_SECRET');
    });

    it('should show CLI push commands for each environment', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev', 'prod'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('cloud-secrets:push --env dev');
      expect(infoCalls).toContain('cloud-secrets:push --env prod');
    });

    it('should show manual set command', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('cloud-secrets:set');
    });

    it('should show Azure Portal link', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('Azure Portal');
      expect(infoCalls).toContain('Key Vaults');
    });

    it('should show secret naming pattern', () => {
      const logger = createMockLogger();
      printSetupInstructions(['API_KEY'], 'myproject', ['dev'], logger);

      const infoCalls = logger.info.mock.calls.map((c) => c[0]).join('\n');
      expect(infoCalls).toContain('myproject-shared-{KEY}');
    });
  });
});
