/**
 * Azure database delete lock (database.deletionProtection)
 *
 * The CLI keeps a CanNotDelete lock on the environment's PostgreSQL Flexible
 * Server, through the SDK and not Terraform: a lock covers the server's
 * databases too, so infra:remove-service and infra:destroy lift it while
 * they delete.
 */

/** Name of the lock on the server */
export const AZURE_DATABASE_LOCK_NAME = 'tsdevstack-database-delete-lock';

/** Text the portal shows with the lock (Azure takes up to 512 characters) */
export const AZURE_DATABASE_LOCK_NOTES =
  'Set by tsdevstack infra:deploy (database.deletionProtection in .tsdevstack/infrastructure.json). infra:destroy and infra:remove-service lift it while they delete.';

/** The server's resource provider and type, as the locks API takes them */
export const AZURE_POSTGRES_RESOURCE_PROVIDER = 'Microsoft.DBforPostgreSQL';
export const AZURE_POSTGRES_RESOURCE_TYPE = 'flexibleServers';
