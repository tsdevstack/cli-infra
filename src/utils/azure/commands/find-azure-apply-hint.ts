/**
 * The hint for a failed Azure apply, when its error is a known one
 */

import { AZURE_APP_SERVICE_PLAN_ERRORS } from '../../../constants';

/**
 * Looks for the App Service plan errors the deploy explains
 * (AZURE_APP_SERVICE_PLAN_ERRORS) in a failed apply's output.
 *
 * @param output - The Terraform apply's output
 * @returns What to do, or undefined for any other error
 */
export function findAzureApplyHint(output: string): string | undefined {
  return AZURE_APP_SERVICE_PLAN_ERRORS.find(({ pattern }) =>
    pattern.test(output),
  )?.hint;
}
