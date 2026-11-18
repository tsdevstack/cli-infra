/**
 * One storage bucket access as a line, the same shape on every provider:
 * "storage.objects.get avatars/u1.png by shop-auth-service-rt@p.iam.gserviceaccount.com from 203.0.113.5",
 * with the provider's error before "by" when the access failed. Azure
 * builds the same shape in KQL (build-azure-source-legs).
 */

export function formatBucketAccessLine(access: {
  /** The provider's operation name (storage.objects.get, GetObject, GetBlob) */
  operation: string;
  /** The object's path in the bucket; empty for the bucket itself (a list) */
  object?: string;
  /** Only when the access failed: the provider's error */
  error?: string;
  /** Who: a service's identity, or the signer of a signed URL */
  principal?: string;
  ip?: string;
}): string {
  const parts = [access.operation, access.object || '(bucket)'];
  if (access.error) {
    parts.push(access.error);
  }
  if (access.principal) {
    parts.push(`by ${access.principal}`);
  }
  if (access.ip) {
    parts.push(`from ${access.ip}`);
  }
  return parts.join(' ');
}
