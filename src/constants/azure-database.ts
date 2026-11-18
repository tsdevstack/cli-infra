/**
 * Azure Database for PostgreSQL constants
 */

/**
 * The flexible server's admin login (Terraform's administrator_login in
 * database.tf). db-init logs in with it to set up each service's roles.
 */
export const AZURE_DATABASE_ADMIN_LOGIN = 'tsdevstack';
