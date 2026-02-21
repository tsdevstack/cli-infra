/**
 * Parse Image Tag
 *
 * Extracts a short display string from a full container image URI.
 * Works with any registry (ECR, GCR, Artifact Registry, Docker Hub).
 */

/**
 * Parse a container image URI into a short display tag.
 *
 * Examples:
 * - `123456.dkr.ecr.us-east-1.amazonaws.com/repo:latest` → `:latest`
 * - `us-docker.pkg.dev/project/repo/image:abc1234` → `:abc1234`
 * - `repo@sha256:abc123...` → `sha256:abc123...`
 * - `undefined` → `-`
 */
export function parseImageTag(imageUri?: string): string {
  if (!imageUri) {
    return '-';
  }

  // Handle digest references (repo@sha256:...)
  const digestIndex = imageUri.lastIndexOf('@sha256:');
  if (digestIndex !== -1) {
    const digest = imageUri.slice(digestIndex + 1);
    // Show first 19 chars of digest (sha256: + 12 hex chars)
    return digest.length > 19 ? digest.slice(0, 19) : digest;
  }

  // Handle tag references (repo:tag)
  const tagIndex = imageUri.lastIndexOf(':');
  if (tagIndex !== -1) {
    return imageUri.slice(tagIndex);
  }

  return '-';
}
