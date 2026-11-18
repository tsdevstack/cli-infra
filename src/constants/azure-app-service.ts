/**
 * Azure App Service constants (Kong and the Next.js apps)
 */

/**
 * API version for the app's SSH switch (`sshEnabled` on the site). azurerm
 * can't set it, and its updates send the whole site without it, so the
 * deploy turns SSH off on every run with a PATCH of that one field.
 * Checked on az6 (2026-11-18): PATCH with this version sets it, GET keeps
 * it; older versions don't return it.
 */
export const AZURE_APP_SERVICE_SSH_API_VERSION = '2026-08-01';
