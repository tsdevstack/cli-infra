/**
 * Validate Access Control
 *
 * Rejects access control fields that belonged to the removed environment
 * password protection feature (`protected`, `cookieTtlHours`).
 */

import { getContext } from '../../context';
import { REMOVED_ACCESS_CONTROL_FIELDS } from '../../constants';

/**
 * Validate the accessControl block of an environment
 *
 * @param environment - Environment name for error messages
 * @param accessControl - Raw accessControl value from infrastructure.json
 * @throws CliError if a removed field is set
 */
export function validateAccessControl(
  environment: string,
  accessControl: unknown,
): void {
  const { CliError } = getContext();

  if (typeof accessControl !== 'object' || accessControl === null) {
    return;
  }

  for (const field of REMOVED_ACCESS_CONTROL_FIELDS) {
    if (field in accessControl) {
      throw new CliError(
        `Unsupported field "accessControl.${field}" in environment "${environment}"`,
        'Infrastructure Config',
        'Environment password protection was removed from tsdevstack. ' +
          `Remove "accessControl.protected" and "accessControl.cookieTtlHours" from ` +
          `.tsdevstack/infrastructure.json. "accessControl.noIndex" is still supported.`,
      );
    }
  }
}
