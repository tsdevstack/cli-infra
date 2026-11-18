/**
 * Saved databases in the exports bucket (AWS)
 */

import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { AWSCredentials } from '@tsdevstack/cli/plugin';
import { buildAWSClientConfig } from '../build-aws-client-config';
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
export async function listAwsDbExports(options: {
  bucket: string;
  serviceName?: string;
  credentials: AWSCredentials;
}): Promise<DbExportFile[]> {
  const s3 = new S3Client(buildAWSClientConfig(options.credentials));
  const files: DbExportFile[] = [];
  let continuationToken: string | undefined;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: options.serviceName ? `${options.serviceName}/` : undefined,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of page.Contents ?? []) {
      const parsed = object.Key ? parseDbExportFileName(object.Key) : null;
      if (
        parsed &&
        (!options.serviceName || parsed.serviceName === options.serviceName)
      ) {
        files.push({ ...parsed, size: object.Size ?? 0 });
      }
    }
    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return files.sort((a, b) => b.time.getTime() - a.time.getTime());
}
