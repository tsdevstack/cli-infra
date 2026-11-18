/**
 * Print CI Setup Instructions
 *
 * Prints instructions for setting up Azure OIDC and user secrets required for deployment.
 */

import { GITHUB_REPO_IDS_COMMAND } from '../../../constants';

/**
 * Print setup instructions for Azure CI/CD
 *
 * @param userSecrets - List of user secret keys from .secrets.user.json
 * @param projectName - Project name for secret naming
 * @param environments - Target environments
 * @param logger - Logger instance
 */
export function printSetupInstructions(
  userSecrets: string[],
  projectName: string,
  environments: string[],
  logger: {
    info: (msg: string) => void;
    newline: () => void;
    warn: (msg: string) => void;
  },
): void {
  logger.newline();
  logger.info('=== Azure OIDC Setup (one-time) ===');
  logger.newline();
  logger.info('Set up GitHub Actions OIDC authentication with Azure:');
  logger.newline();

  logger.info('1. Create or reuse Azure AD App Registration');
  logger.info('   Azure Portal → App registrations → New registration');
  logger.info(
    '   (You can reuse the existing Service Principal from cloud:init)',
  );
  logger.newline();

  logger.info('2. Add two Federated Credentials for GitHub Actions OIDC');
  logger.info(
    '   App registration → Certificates & secrets → Federated credentials',
  );
  logger.info('   → Add credential, once for each subject below');
  logger.info('   Issuer: https://token.actions.githubusercontent.com');
  logger.info('   Subject: repo:YOUR_ORG/YOUR_REPO:ref:refs/heads/main');
  logger.info(
    '   Subject: repo:YOUR_ORG@OWNER_ID/YOUR_REPO@REPO_ID:ref:refs/heads/main',
  );
  logger.info('   Audience: api://AzureADTokenExchange');
  logger.info(
    '   Azure matches the subject exactly (no wildcards). GitHub signs workflows of',
  );
  logger.info(
    '   repositories created after 15 July 2026 with the second form (owner and',
  );
  logger.info(
    '   repository IDs); older ones use the first. Keep both. Your OWNER_ID and REPO_ID:',
  );
  logger.info(`     ${GITHUB_REPO_IDS_COMMAND}`);
  logger.info(
    '   Both name main: run the deploy workflows from main (Run workflow → main).',
  );
  logger.newline();

  logger.info('3. Verify SP has required roles on the Resource Group');
  logger.info('   (Same roles as cloud:init):');
  logger.info('   - Contributor');
  logger.info('   - Key Vault Secrets Officer');
  logger.info('   - User Access Administrator');
  logger.newline();

  logger.info('4. Set GitHub Repository Secrets');
  for (const env of environments) {
    const envUpper = env.toUpperCase();
    logger.info(`   AZURE_CLIENT_ID_${envUpper}:`);
    logger.info('     Application (client) ID');
    logger.info(`   AZURE_TENANT_ID_${envUpper}:`);
    logger.info('     Directory (tenant) ID');
    logger.info(`   AZURE_SUBSCRIPTION_ID_${envUpper}:`);
    logger.info('     Azure Subscription ID');
    logger.info(`   AZURE_LOCATION_${envUpper}:`);
    logger.info('     e.g., eastus');
  }
  logger.newline();

  logger.info(
    '   No AZURE_CLIENT_SECRET needed — all SDK calls use DefaultAzureCredential',
  );
  logger.info('   in CI mode (OIDC session from azure/login@v2).');
  logger.newline();

  logger.info('=== Troubleshooting ===');
  logger.newline();
  logger.info('  "AADSTS700016: Application with identifier was not found"');
  logger.info(
    '    → Verify AZURE_CLIENT_ID secret matches the App Registration',
  );
  logger.newline();
  logger.info('  "No matching federated identity record found"');
  logger.info(
    '    → Verify both subjects of step 2 exist, with your IDs and branch main',
  );
  logger.info('    → Verify id-token: write permission is set in workflow');
  logger.newline();

  logger.info('=== User Secrets Setup ===');
  logger.newline();

  if (userSecrets.length === 0) {
    logger.info('No user secrets found in .secrets.user.json');
    logger.newline();
    return;
  }

  logger.info('Set these secrets for each environment before deploying:');
  logger.newline();

  for (const key of userSecrets) {
    logger.info(`  - ${key}`);
  }

  logger.newline();
  logger.info('Options to set secrets:');
  logger.newline();

  logger.info('  1. CLI (if you have credentials configured):');
  for (const env of environments) {
    logger.info(`     npx tsdevstack cloud-secrets:push --env ${env}`);
  }
  logger.newline();

  logger.info('  2. Set one at a time:');
  logger.info('     npx tsdevstack cloud-secrets:set API_URL --env prod');
  logger.newline();

  logger.info('  3. Azure Portal (manual):');
  logger.info('     Azure Portal → Key Vaults → Select vault → Secrets');
  logger.info(`     Secret naming: ${projectName}-shared-{KEY}`);
  logger.newline();
}
