/**
 * Put Database Lock (Azure)
 *
 * Puts the CanNotDelete lock on the environment's PostgreSQL Flexible
 * Server. Putting it again changes nothing.
 */

import { ManagementLockClient } from '@azure/arm-locks';
import { createAzureCredential } from '@tsdevstack/infra-core';
import { buildRuntime } from '../../build-runtime';
import {
  AZURE_DATABASE_LOCK_NAME,
  AZURE_DATABASE_LOCK_NOTES,
  AZURE_POSTGRES_RESOURCE_PROVIDER,
  AZURE_POSTGRES_RESOURCE_TYPE,
} from '../../../constants';
import type { DatabaseLockTarget } from './types';

/**
 * Put the delete lock on the server
 *
 * @throws The SDK's error (no permission: Microsoft.Authorization/locks/write)
 */
export async function putDatabaseLock(
  target: DatabaseLockTarget,
): Promise<void> {
  const { credentials, resourceGroupName, serverName } = target;
  const client = new ManagementLockClient(
    createAzureCredential(buildRuntime(), credentials),
    credentials.subscriptionId,
  );

  // The resource-level call: the scope-level one URL-encodes the slashes of
  // the scope. No parent resource: the server sits right in the group.
  await client.managementLocks.createOrUpdateAtResourceLevel(
    resourceGroupName,
    AZURE_POSTGRES_RESOURCE_PROVIDER,
    '',
    AZURE_POSTGRES_RESOURCE_TYPE,
    serverName,
    AZURE_DATABASE_LOCK_NAME,
    { level: 'CanNotDelete', notes: AZURE_DATABASE_LOCK_NOTES },
  );
}
