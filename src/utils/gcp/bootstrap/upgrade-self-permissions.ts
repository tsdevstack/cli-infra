/**
 * Upgrade Self Permissions
 *
 * Adds additional IAM roles to the Deploy SA.
 * Part of the bootstrap process - run once per project.
 */

import { ProjectsClient } from '@google-cloud/resource-manager';
import { getContext } from '../../../context';
import { GCP_DEPLOY_SA_ROLES } from '../../../constants';
import type { GCPCommandContext } from '../commands/types';

/**
 * Add all required IAM roles to the Deploy SA
 */
export async function upgradeSelfPermissions(
  ctx: GCPCommandContext,
): Promise<void> {
  const { logger, buildGCPClientOptions } = getContext();
  const { credentials } = ctx;
  const projectId = credentials.project_id;
  const saEmail = credentials.client_email;

  const client = new ProjectsClient(buildGCPClientOptions(credentials));

  const [policy] = await client.getIamPolicy({
    resource: `projects/${projectId}`,
  });

  let rolesAdded = 0;

  for (const role of GCP_DEPLOY_SA_ROLES) {
    const member = `serviceAccount:${saEmail}`;

    let binding = policy.bindings?.find((b) => b.role === role);
    if (!binding) {
      binding = { role, members: [] };
      policy.bindings = policy.bindings || [];
      policy.bindings.push(binding);
    }

    if (!binding.members?.includes(member)) {
      binding.members = binding.members || [];
      binding.members.push(member);
      logger.info(`  + ${role}`);
      rolesAdded++;
    } else {
      logger.info(`  ✓ ${role} (already has)`);
    }
  }

  if (rolesAdded > 0) {
    await client.setIamPolicy({
      resource: `projects/${projectId}`,
      policy,
    });
    logger.success(`Added ${rolesAdded} roles to SA`);
  } else {
    logger.success('SA already has all required roles');
  }
}
