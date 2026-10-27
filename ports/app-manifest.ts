/**
 * The app-side types and validator for `app.manifest.json` (spine AD-26/AD-34;
 * contracts schema `schemas/ags-app-manifest.schema.json`).
 *
 * The contracts repo owns the language-neutral schema. This module mirrors it
 * for app repos: the identity fields are exactly one lowercase path segment,
 * `mode` is `live|restart`, and `restart` is impossible while
 * `holdsUnsavedState` is true. `validateAgsAppManifest` is the runtime
 * counterpart of the schema's `additionalProperties: false`, `const`,
 * `pattern` and `allOf` restart rule.
 *
 * The deployed-identity equality (`instance == app.tsx == ags list`,
 * `configDir == config-link basename`) is runtime-owned: a repo-local test can
 * validate the manifest's shape, but only the runtime can compare it with a
 * deployed link and a running process.
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

/** The manifest file every standalone AGS app ships at its repo root (AD-26). */
export const AGS_APP_MANIFEST_FILE = "app.manifest.json";

/** The only schema version this platform understands; unknown versions fail (AD-34). */
export const AGS_APP_MANIFEST_SCHEMA_VERSION = 1;

/**
 * Exactly one lowercase path segment: no slash, no dot path, no uppercase, no
 * leading/trailing hyphen. Kept byte-for-byte equivalent to the contracts
 * schema's `pathSegment` definition.
 */
export const AGS_APP_PATH_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type AgsAppMode = "live" | "restart";

interface AgsAppManifestBase {
  schemaVersion: typeof AGS_APP_MANIFEST_SCHEMA_VERSION;
  /** App id: one lowercase path segment. */
  app: string;
  /** AGS instance name: one lowercase path segment. */
  instance: string;
  /** Deployed config-dir basename: one lowercase path segment. */
  configDir: string;
}

/** A live app answers `palette-refresh` in place (AD-27). */
export interface AgsAppManifestLive extends AgsAppManifestBase {
  mode: "live";
  /** May be true: a live refresh must preserve pending state, never restart. */
  holdsUnsavedState: boolean;
}

/** A restart app is restarted by the serialized lane; restart is never a fallback. */
export interface AgsAppManifestRestart extends AgsAppManifestBase {
  mode: "restart";
  /** The schema forbids restart when a restart could discard user work (AD-30). */
  holdsUnsavedState: false;
}

/**
 * The manifest union. Discriminating on `mode` narrows
 * `holdsUnsavedState` to `false` for a restart app, so the schema's
 * "restart is invalid when holdsUnsavedState is true" rule is also a type rule.
 */
export type AgsAppManifest = AgsAppManifestLive | AgsAppManifestRestart;

/** A schema-level problem, with the manifest field path that failed. */
export interface AgsAppManifestIssue {
  path: string;
  message: string;
}

export type AgsAppManifestValidation =
  | { ok: true; manifest: AgsAppManifest }
  | { ok: false; issues: AgsAppManifestIssue[] };

const MANIFEST_FIELDS = new Set([
  "schemaVersion",
  "app",
  "instance",
  "configDir",
  "mode",
  "holdsUnsavedState",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateIdentity(
  value: Record<string, unknown>,
  field: "app" | "instance" | "configDir",
  issues: AgsAppManifestIssue[],
): void {
  const fieldValue = value[field];
  if (
    typeof fieldValue !== "string" ||
    !AGS_APP_PATH_SEGMENT_PATTERN.test(fieldValue)
  ) {
    issues.push({
      path: field,
      message: `${field} must be exactly one lowercase path segment`,
    });
  }
}

/**
 * Validate an already-parsed manifest against the contracts schema. Returning
 * issues (rather than throwing) lets a repo gate report every drift at once and
 * lets a runtime record a structured invalid-manifest failure (AD-26).
 */
export function validateAgsAppManifest(value: unknown): AgsAppManifestValidation {
  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "$", message: "the manifest must be a JSON object" }],
    };
  }

  const issues: AgsAppManifestIssue[] = [];

  for (const field of Object.keys(value)) {
    if (!MANIFEST_FIELDS.has(field)) {
      issues.push({ path: field, message: `unknown manifest field "${field}"` });
    }
  }

  if (value.schemaVersion !== AGS_APP_MANIFEST_SCHEMA_VERSION) {
    issues.push({
      path: "schemaVersion",
      message: `schemaVersion must be ${AGS_APP_MANIFEST_SCHEMA_VERSION}`,
    });
  }

  validateIdentity(value, "app", issues);
  validateIdentity(value, "instance", issues);
  validateIdentity(value, "configDir", issues);

  const mode = value.mode;
  if (mode !== "live" && mode !== "restart") {
    issues.push({ path: "mode", message: 'mode must be "live" or "restart"' });
  }

  if (typeof value.holdsUnsavedState !== "boolean") {
    issues.push({
      path: "holdsUnsavedState",
      message: "holdsUnsavedState must be a boolean",
    });
  } else if (mode === "restart" && value.holdsUnsavedState) {
    issues.push({
      path: "holdsUnsavedState",
      message: "restart is invalid when holdsUnsavedState is true",
    });
  }

  if (issues.length > 0) return { ok: false, issues };

  // The checks above prove every field. Construct explicitly so no extra key
  // can leak into the typed manifest.
  return {
    ok: true,
    manifest: {
      schemaVersion: AGS_APP_MANIFEST_SCHEMA_VERSION,
      app: value.app as string,
      instance: value.instance as string,
      configDir: value.configDir as string,
      mode: mode as AgsAppMode,
      holdsUnsavedState: value.holdsUnsavedState as boolean,
    } as AgsAppManifest,
  };
}

/** Parse and validate a manifest file's text; invalid JSON is an issue, not a throw. */
export function parseAgsAppManifest(text: string): AgsAppManifestValidation {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      issues: [{ path: "$", message: `the manifest is not valid JSON: ${message}` }],
    };
  }
  return validateAgsAppManifest(value);
}
