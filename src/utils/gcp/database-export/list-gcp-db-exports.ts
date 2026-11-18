/**
 * Saved databases in the exports bucket (GCP)
 */

import { Storage } from '@google-cloud/storage';
import type { GCPCredentials } from '@tsdevstack/cli/plugin';
import { getContext } from '../../../context';
import { parseDbExportFileName } from '../../database-export/parse-db-export-file-name';
import type { DbExportFile } from '../../database-export/types';

/**
 * Lists {service}/ in the bucket (the whole bucket without a service) as
 * the deploy account. Files with other names are left out.
 *
 * @param options.bucket - The exports bucket
 * @param options.serviceName - The service (all services when left out)
 * @param options.credentials - The deploy account
 * @returns The files, newest first
 */
export async function listGcpDbExports(options: {
  bucket: string;
  serviceName?: string;
  credentials: GCPCredentials;
}): Promise<DbExportFile[]> {
  const { buildGCPClientOptions } = getContext();
  const storage = new Storage(buildGCPClientOptions(options.credentials));
  const [objects] = await storage
    .bucket(options.bucket)
    .getFiles(options.serviceName ? { prefix: `${options.serviceName}/` } : {});

  const files: DbExportFile[] = [];
  for (const object of objects) {
    const parsed = parseDbExportFileName(object.name);
    if (
      parsed &&
      (!options.serviceName || parsed.serviceName === options.serviceName)
    ) {
      files.push({ ...parsed, size: Number(object.metadata.size ?? 0) });
    }
  }
  return files.sort((a, b) => b.time.getTime() - a.time.getTime());
}
