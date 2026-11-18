/**
 * Azure infra:logs Types (--follow)
 */

import type { ContainerAppsAPIClient } from '@azure/arm-appcontainers';
import type { LogsQuery } from '../../logs/types';

/** A read of the Log Analytics workspace */
export interface AzureLogsQuery extends LogsQuery {
  /**
   * --follow: Kong's and the Next.js apps' output and events come live from
   * Kudu, so only App Service's request log is read here
   */
  appServiceLive?: boolean;
}

/** The Container Apps calls --follow makes */
export type AzureContainerAppsClient = Pick<
  ContainerAppsAPIClient,
  'containerApps' | 'containerAppsRevisions' | 'containerAppsRevisionReplicas'
>;

/** One running container of a replica of an active revision */
export interface AzureReplicaContainer {
  /** `{revision}/{replica}/{container}` */
  key: string;
  revision: string;
  replica: string;
  container: string;
  /** The container's log stream URL (Azure's, without the query) */
  logStreamEndpoint: string;
}
