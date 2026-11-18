/**
 * Print CI Setup Instructions
 *
 * Prints instructions for setting up OIDC and user secrets required for deployment.
 */

import { AWS_CICD_DOCS_URL, GITHUB_REPO_IDS_COMMAND } from '../../../constants';

/**
 * Print setup instructions for AWS CI/CD
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
  logger.info('=== AWS OIDC Setup (one-time) ===');
  logger.newline();
  logger.info('Set up GitHub Actions OIDC authentication with AWS:');
  logger.newline();

  logger.info('1. Create IAM OIDC Identity Provider');
  logger.info('   IAM → Identity Providers → Add Provider');
  logger.info('   Provider type: OpenID Connect');
  logger.info('   Provider URL: https://token.actions.githubusercontent.com');
  logger.info('   Audience: sts.amazonaws.com');
  logger.newline();

  logger.info('2. Create IAM Role for GitHub Actions');
  logger.info('   IAM → Roles → Create Role');
  logger.info('   Trusted entity: Web identity');
  logger.info('   Identity provider: token.actions.githubusercontent.com');
  logger.info('   Audience: sts.amazonaws.com');
  logger.info('   GitHub organization: YOUR_ORG (or username)');
  logger.info('   GitHub repository: YOUR_REPO');
  logger.info('   Role name: github-actions-deploy');
  logger.info(
    '   The console writes only the older subject form; step 3 adds the newer one.',
  );
  logger.newline();

  logger.info('3. Edit the Trust Policy');
  logger.info(
    '   Go to role → Trust relationships → Edit, so that it looks like:',
  );
  logger.newline();
  logger.info('   {');
  logger.info('     "Version": "2012-10-17",');
  logger.info('     "Statement": [{');
  logger.info('       "Effect": "Allow",');
  logger.info('       "Principal": {');
  logger.info(
    '         "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"',
  );
  logger.info('       },');
  logger.info('       "Action": "sts:AssumeRoleWithWebIdentity",');
  logger.info('       "Condition": {');
  logger.info('         "StringEquals": {');
  logger.info(
    '           "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"',
  );
  logger.info('         },');
  logger.info('         "StringLike": {');
  logger.info('           "token.actions.githubusercontent.com:sub": [');
  logger.info('             "repo:YOUR_ORG/YOUR_REPO:*",');
  logger.info('             "repo:YOUR_ORG@OWNER_ID/YOUR_REPO@REPO_ID:*"');
  logger.info('           ]');
  logger.info('         }');
  logger.info('       }');
  logger.info('     }]');
  logger.info('   }');
  logger.newline();
  logger.info(
    '   GitHub signs workflows of repositories created after 15 July 2026 with',
  );
  logger.info(
    '   the second form (owner and repository IDs); older ones use the first.',
  );
  logger.info('   Keep both. Your OWNER_ID and REPO_ID:');
  logger.info(`     ${GITHUB_REPO_IDS_COMMAND}`);
  logger.newline();

  logger.info('4. Add Permissions (Inline Policy)');
  logger.info(`   Policy JSON: ${AWS_CICD_DOCS_URL} (Step 3)`);
  logger.newline();

  logger.info('5. Set GitHub Repository Secrets');
  for (const env of environments) {
    const envUpper = env.toUpperCase();
    logger.info(`   AWS_ROLE_ARN_${envUpper}:`);
    logger.info('     arn:aws:iam::ACCOUNT_ID:role/github-actions-deploy');
    logger.info(`   AWS_REGION_${envUpper}:`);
    logger.info('     e.g., us-east-1');
  }
  logger.newline();

  logger.info('=== Troubleshooting ===');
  logger.newline();
  logger.info('  "Not authorized to perform sts:AssumeRoleWithWebIdentity"');
  logger.info(
    '    → The trust policy needs both subject forms (step 3), with your IDs',
  );
  logger.info('    → Verify id-token: write permission is set in workflow');
  logger.newline();
  logger.info('  "Could not assume role with OIDC"');
  logger.info('    → Verify AWS_ROLE_ARN_ENV secret matches the role ARN');
  logger.info(
    '    → Verify OIDC Identity Provider exists in the target account',
  );
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

  logger.info('  3. AWS Console (manual):');
  logger.info('     https://console.aws.amazon.com/secretsmanager/listsecrets');
  logger.info(`     Secret naming: ${projectName}-shared-{KEY}`);
  logger.newline();
}
