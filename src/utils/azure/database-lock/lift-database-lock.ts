/**
 * Lift Database Lock (Azure)
 *
 * Takes the CLI's delete lock off the environment's PostgreSQL Flexible
 * Server. Only the CLI's own lock: a lock someone added by hand stays.
 */

import { ManagementLockClient } from '@azure/arm-locks';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import {
  AZURE_DATABASE_LOCK_NAME,
  AZURE_POSTGRES_RESOURCE_PROVIDER,
  AZURE_POSTGRES_RESOURCE_TYPE,
} from '../../../constants';
import type { DatabaseLockTarget } from './types';

/**
 * Lift the delete lock from the server
 *
 * @returns true when the lock was on and is now off; false when there was
 *   none (also when the server or its resource group is gone)
 * @throws The SDK's error (no permission: Microsoft.Authorization/locks/delete)
 */
export async function liftDatabaseLock(
  target: DatabaseLockTarget,
): Promise<boolean> {
  const { credentials, resourceGroupName, serverName } = target;
  const client = new ManagementLockClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );

  // The resource-level calls: the scope-level ones URL-encode the slashes
  // of the scope. No parent resource: the server sits right in the group.
  const lock = [
    resourceGroupName,
    AZURE_POSTGRES_RESOURCE_PROVIDER,
    '',
    AZURE_POSTGRES_RESOURCE_TYPE,
    serverName,
    AZURE_DATABASE_LOCK_NAME,
  ] as const;

  try {
    await client.managementLocks.getAtResourceLevel(...lock);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) {
      return false;
    }
    throw error;
  }

  await client.managementLocks.deleteAtResourceLevel(...lock);
  return true;
}
