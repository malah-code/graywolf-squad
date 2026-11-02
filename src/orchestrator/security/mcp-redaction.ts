/**
 * ADR-055 MCP Server Credential Redaction & Secure Probe Pattern
 * (Task 16.1b, ADR-055, FR-002).
 *
 * Rules:
 * 1. Settings UI receives `REDACTED_MCP_SECRET_VALUE = "**********"` for all credential leaves.
 * 2. On user edit, untouched `"**********"` leaves preserve their existing server-side encrypted values.
 * 3. Before dispatching a connectivity probe, server recursively re-hydrates `"**********"` leaves
 *    with real decrypted values in memory, executing the probe without cleartext exposure.
 */

export const REDACTED_MCP_SECRET_VALUE = '**********';

const SENSITIVE_KEY_REGEX = /(?:api[_-]?key|token|secret|password|auth(?:orization)?|credential|private[_-]?key)/i;

/**
 * Checks whether a given property name or JSON path is considered a sensitive credential leaf.
 */
export function isSensitiveMcpKey(
  keyName: string,
  keyPath = '',
  secretRefs?: string[]
): boolean {
  if (SENSITIVE_KEY_REGEX.test(keyName)) {
    return true;
  }
  if (secretRefs && secretRefs.length > 0) {
    for (const ref of secretRefs) {
      if (
        ref === keyName ||
        ref === keyPath ||
        keyPath.endsWith(`.${ref}`) ||
        keyPath.endsWith(`/${ref}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Deep clones an arbitrary JSON-like value.
 */
function deepClone<T>(val: T): T {
  if (val === null || typeof val !== 'object') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => deepClone(item)) as unknown as T;
  }
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    copy[k] = deepClone(v);
  }
  return copy as T;
}

/**
 * Recursively masks sensitive credential leaves in an MCP server config for UI presentation.
 */
export function redactMcpConfigForUi<T extends Record<string, unknown>>(
  config: T,
  secretRefs?: string[]
): T {
  const cloned = deepClone(config);

  function walk(obj: unknown, currentPath: string): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        walk(obj[i], `${currentPath}[${i}]`);
      }
      return;
    }

    const rec = obj as Record<string, unknown>;
    for (const [key, val] of Object.entries(rec)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      if (typeof val === 'string') {
        if (val.length > 0 && isSensitiveMcpKey(key, nextPath, secretRefs)) {
          rec[key] = REDACTED_MCP_SECRET_VALUE;
        }
      } else if (typeof val === 'object' && val !== null) {
        walk(val, nextPath);
      }
    }
  }

  walk(cloned, '');
  return cloned;
}

/**
 * Recursively merges incoming UI updates into existing server configuration,
 * preserving existing encrypted secret leaves when the user leaves them as `"**********"`.
 */
export function mergeMcpConfigOnUpdate<T extends Record<string, unknown>>(
  existingConfig: T,
  incomingUiConfig: T,
  _secretRefs?: string[]
): T {
  const merged = deepClone(incomingUiConfig);

  function walk(incoming: unknown, existing: unknown, currentPath: string): void {
    if (!incoming || typeof incoming !== 'object') {
      return;
    }
    if (Array.isArray(incoming)) {
      const existingArr = Array.isArray(existing) ? existing : [];
      for (let i = 0; i < incoming.length; i++) {
        walk(incoming[i], existingArr[i], `${currentPath}[${i}]`);
      }
      return;
    }

    const inRec = incoming as Record<string, unknown>;
    const exRec = (existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing
      : {}) as Record<string, unknown>;

    for (const [key, val] of Object.entries(inRec)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      if (val === REDACTED_MCP_SECRET_VALUE) {
        // Preserve existing stored secret
        if (exRec[key] !== undefined) {
          inRec[key] = exRec[key];
        }
      } else if (typeof val === 'object' && val !== null) {
        walk(val, exRec[key], nextPath);
      }
    }
  }

  walk(merged, existingConfig, '');
  return merged;
}

/**
 * Re-hydrates `"**********"` placeholder leaves in an MCP config with real decrypted secret values
 * in memory strictly for connectivity probes (ADR-055).
 */
export function rehydrateMcpConfigForProbe<T extends Record<string, unknown>>(
  uiRedactedConfig: T,
  serverSecretsRecord: Record<string, unknown>,
  _secretRefs?: string[]
): T {
  const rehydrated = deepClone(uiRedactedConfig);

  function walk(obj: unknown, currentPath: string): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        walk(obj[i], `${currentPath}[${i}]`);
      }
      return;
    }

    const rec = obj as Record<string, unknown>;
    for (const [key, val] of Object.entries(rec)) {
      const nextPath = currentPath ? `${currentPath}.${key}` : key;
      if (val === REDACTED_MCP_SECRET_VALUE) {
        // Resolve from server secrets record by keyName or path
        const resolvedSecret =
          serverSecretsRecord[nextPath] ??
          serverSecretsRecord[key] ??
          findNestedValue(serverSecretsRecord, nextPath);
        if (resolvedSecret !== undefined && typeof resolvedSecret === 'string') {
          rec[key] = resolvedSecret;
        }
      } else if (typeof val === 'object' && val !== null) {
        walk(val, nextPath);
      }
    }
  }

  function findNestedValue(src: Record<string, unknown>, dotPath: string): unknown {
    const parts = dotPath.split('.');
    let curr: unknown = src;
    for (const part of parts) {
      if (!curr || typeof curr !== 'object') {
        return undefined;
      }
      curr = (curr as Record<string, unknown>)[part];
    }
    return curr;
  }

  walk(rehydrated, '');
  return rehydrated;
}
