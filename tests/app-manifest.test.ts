import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AGS_APP_MANIFEST_FILE,
  AGS_APP_MANIFEST_SCHEMA_VERSION,
  parseAgsAppManifest,
  validateAgsAppManifest,
  type AgsAppManifest,
} from "../ports/app-manifest.ts"

/**
 * The two shapes the contracts schema permits. `satisfies` is part of the
 * assertion: if the exported type drifts from the schema (a renamed field, a
 * widened mode, a boolean that should be literal false), this file stops
 * typechecking.
 */
const live = {
  schemaVersion: 1,
  app: "clipboard",
  instance: "clipboard",
  configDir: "ags-clipboard",
  mode: "live",
  holdsUnsavedState: false,
} satisfies AgsAppManifest

const restart = {
  schemaVersion: 1,
  app: "bar",
  instance: "ags",
  configDir: "ags",
  mode: "restart",
  holdsUnsavedState: false,
} satisfies AgsAppManifest

test("the manifest constants mirror the contracts schema", () => {
  assert.equal(AGS_APP_MANIFEST_FILE, "app.manifest.json")
  assert.equal(AGS_APP_MANIFEST_SCHEMA_VERSION, 1)
})

test("accepts the live and restart shapes from the schema", () => {
  assert.deepEqual(validateAgsAppManifest(live), { ok: true, manifest: live })
  assert.deepEqual(validateAgsAppManifest(restart), { ok: true, manifest: restart })
})

test("restart is invalid when holdsUnsavedState is true", () => {
  const result = validateAgsAppManifest({ ...restart, holdsUnsavedState: true })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.ok(
    result.issues.some((issue) => issue.path === "holdsUnsavedState"),
    "the issue must name the state field",
  )
})

test("rejects unknown fields and a wrong schemaVersion", () => {
  const unknown = validateAgsAppManifest({ ...live, extra: true })
  assert.equal(unknown.ok, false)
  if (!unknown.ok) {
    assert.ok(unknown.issues.some((issue) => issue.path === "extra"))
  }

  const version = validateAgsAppManifest({ ...live, schemaVersion: 2 })
  assert.equal(version.ok, false)
  if (!version.ok) {
    assert.ok(version.issues.some((issue) => issue.path === "schemaVersion"))
  }
})

test("rejects an identity field that is not one lowercase path segment", () => {
  for (const value of ["Clipboard", "ags/clipboard", "ags.clipboard", "-ags", "ags-", ""]) {
    const result = validateAgsAppManifest({ ...live, configDir: value })
    assert.equal(result.ok, false, `configDir ${JSON.stringify(value)} must be rejected`)
    if (!result.ok) {
      assert.ok(
        result.issues.some((issue) => issue.path === "configDir"),
        `configDir ${JSON.stringify(value)} must name the field`,
      )
    }
  }
})

test("rejects missing fields, wrong types and non-objects", () => {
  for (const value of [null, [], "manifest", 1]) {
    assert.equal(validateAgsAppManifest(value).ok, false)
  }

  const missing = validateAgsAppManifest({ ...live, app: undefined })
  assert.equal(missing.ok, false)

  const wrongMode = validateAgsAppManifest({ ...live, mode: "startup" })
  assert.equal(wrongMode.ok, false)

  const wrongState = validateAgsAppManifest({ ...live, holdsUnsavedState: "false" })
  assert.equal(wrongState.ok, false)
})

test("parseAgsAppManifest reports invalid JSON as an issue instead of throwing", () => {
  const result = parseAgsAppManifest("{not json")
  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.issues[0].message, /JSON/i)

  const parsed = parseAgsAppManifest(JSON.stringify(live))
  assert.deepEqual(parsed, { ok: true, manifest: live })
})
