/**
 * Convert service name to TF_VAR suffix
 */

/**
 * Convert service name to TF_VAR suffix
 * auth-service -> auth
 * offers-service -> offers
 */
export function toTfVarSuffix(serviceName: string): string {
  return serviceName.replace(/-service$/, '').replace(/-/g, '_');
}
