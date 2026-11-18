/**
 * Drop the default values a decoded protobuf message carries for unset
 * fields (empty text, false, 0, null, empty objects), which the REST API
 * leaves out. Goes through plain objects and arrays; returns undefined
 * when nothing is left.
 */

export function omitGcpProtoDefaults(value: unknown): unknown {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    value === false ||
    value === 0
  ) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => omitGcpProtoDefaults(item))
      .filter((item) => item !== undefined);
    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return value;
    }
    const result: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      const kept = omitGcpProtoDefaults(field);
      if (kept !== undefined) {
        result[key] = kept;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }

  return value;
}
