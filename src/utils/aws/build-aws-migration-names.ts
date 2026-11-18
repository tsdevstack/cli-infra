/**
 * Build AWS Migration Names
 *
 * A service's migration runs as a one-off ECS task. The CLI registers its
 * task definition and creates its log group (not Terraform), with the
 * project in both names like every other AWS resource, so two projects in
 * one account never share them:
 * - task family `{project}-migrate-{service}`
 * - log group `/ecs/{project}/migrate-{service}` (next to the services' own
 *   `/ecs/{project}/{name}`)
 *
 * Environments deployed before kept the names without the project
 * (`migrate-{service}-migration`, `/ecs/migrate-{service}-migration`) until
 * their next migration: infra:logs still reads them, and infra:destroy and
 * remove-service still delete them.
 */

import {
  AWS_ECS_LOG_GROUP_PREFIX,
  AWS_MIGRATION_TASK_FAMILY_SUFFIX,
  MIGRATION_LOG_SOURCE_PREFIX,
} from '../../constants';

export interface AwsMigrationNames {
  taskFamily: string;
  logGroupName: string;
  /** The family used before the project was in the name */
  legacyTaskFamily: string;
  /** The log group used before the project was in the name */
  legacyLogGroupName: string;
}

export function buildAwsMigrationNames(
  projectName: string,
  serviceName: string,
): AwsMigrationNames {
  const taskName = `${MIGRATION_LOG_SOURCE_PREFIX}${serviceName}`;
  const legacyTaskFamily = `${taskName}${AWS_MIGRATION_TASK_FAMILY_SUFFIX}`;
  return {
    taskFamily: `${projectName}-${taskName}`,
    logGroupName: `${AWS_ECS_LOG_GROUP_PREFIX}${projectName}/${taskName}`,
    legacyTaskFamily,
    legacyLogGroupName: `${AWS_ECS_LOG_GROUP_PREFIX}${legacyTaskFamily}`,
  };
}
