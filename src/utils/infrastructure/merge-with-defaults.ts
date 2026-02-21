/**
 * Merge with Defaults - Barrel Export
 *
 * Re-exports all merge and get config functions.
 */

// Service
export { mergeServiceWithDefaults as mergeWithDefaults } from './merge-service-with-defaults';
export { getServiceConfig } from './get-service-config';

// Database
export { mergeDatabaseWithDefaults } from './merge-database-with-defaults';
export { getDatabaseConfig } from './get-database-config';

// Redis
export { mergeRedisWithDefaults } from './merge-redis-with-defaults';
export { getRedisConfig } from './get-redis-config';

// Kong
export { mergeKongWithDefaults } from './merge-kong-with-defaults';
export { getKongConfig } from './get-kong-config';

// Scheduled Jobs
export { getScheduledJobs } from './get-scheduled-jobs';

// App Service
export { mergeAppServiceWithDefaults } from './merge-app-service-with-defaults';
export { getAppServiceConfig } from './get-app-service-config';

// Migration Job
export { getMigrationJobConfig } from './get-migration-job-config';
