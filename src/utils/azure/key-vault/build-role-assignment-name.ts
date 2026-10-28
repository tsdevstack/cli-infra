/**
 * Name of a role assignment, derived from what it grants
 */

import { createHash } from 'node:crypto';

/**
 * A role assignment's name is a GUID. Deriving it from the scope, the
 * principal and the role makes a repeated grant write the same assignment
 * instead of adding another one.
 *
 * @param scope - Resource ID the role applies to
 * @param principalId - Object ID of the identity
 * @param roleDefinitionId - Built-in role ID
 * @returns A version-5-shaped GUID
 */
export function buildRoleAssignmentName(
  scope: string,
  principalId: string,
  roleDefinitionId: string,
): string {
  const hex = createHash('sha256')
    .update(`${scope}|${principalId}|${roleDefinitionId}`)
    .digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}
