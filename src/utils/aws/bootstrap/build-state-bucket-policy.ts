/**
 * The Terraform state bucket's policy: refuse every request not made over
 * HTTPS, on the bucket and its objects. The same statement the generated
 * buckets carry (infra-core buildDenyInsecureTransportStatement), as JSON
 * for PutBucketPolicy. A Deny with Principal "*" is not public, so Block
 * Public Access accepts it.
 */

export function buildStateBucketPolicy(bucketName: string): string {
  const bucketArn = `arn:aws:s3:::${bucketName}`;
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'DenyInsecureTransport',
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: [bucketArn, `${bucketArn}/*`],
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      },
    ],
  });
}
