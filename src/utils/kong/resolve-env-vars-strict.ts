/**
 * Resolve ${ENV_VAR} placeholders - STRICT mode (throws on missing)
 */

import type { JsonValue } from 'tsdevstack/plugin';
import { getContext } from '../../context';

/**
 * Resolve ${ENV_VAR} placeholders in an object recursively.
 * STRICT mode - throws CliError if any placeholder is not found.
 */
export function resolveEnvVarsStrict(
  obj: JsonValue,
  secrets: Record<string, string>,
): JsonValue {
  const { CliError } = getContext();

  if (typeof obj === 'string') {
    // Check if the entire string is a single placeholder (e.g., "${REDIS_PORT}")
    // Excludes Kong's ${{env "..."}} runtime syntax (double braces)
    const singlePlaceholderMatch = obj.match(/^\$\{(?!\{)([^}]+)\}$/);
    if (singlePlaceholderMatch) {
      const varName = singlePlaceholderMatch[1];
      const value = secrets[varName];
      if (value === undefined) {
        throw new CliError(
          `Secret '${varName}' not found in Secret Manager`,
          'infra:build-kong',
          `Ensure ${varName} is pushed: npx tsdevstack cloud-secrets:set ${varName} --env <env>`,
        );
      }
      // Convert to number if it's a numeric string (for Kong integer fields like port)
      if (/^\d+$/.test(value)) {
        return parseInt(value, 10);
      }
      return value;
    }

    // For embedded placeholders, do string replacement
    // Excludes Kong's ${{env "..."}} runtime syntax (double braces)
    return obj.replace(/\$\{(?!\{)([^}]+)\}/g, (_match, varName) => {
      const value = secrets[varName];
      if (value === undefined) {
        throw new CliError(
          `Secret '${varName}' not found in Secret Manager`,
          'infra:build-kong',
          `Ensure ${varName} is pushed: npx tsdevstack cloud-secrets:set ${varName} --env <env>`,
        );
      }
      return value;
    });
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveEnvVarsStrict(item, secrets));
  }

  if (obj && typeof obj === 'object') {
    const resolved: { [key: string]: JsonValue } = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveEnvVarsStrict(value as JsonValue, secrets);
    }
    return resolved;
  }

  return obj;
}
