import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  APPEARANCE_PROVIDER_PRIORITY,
  APPEARANCE_TOKEN_GROUPS,
  APPEARANCE_VERSION,
  AppearanceParseError,
  appearanceValue,
  createAppearanceValue,
  createReplacingAppearanceCssSink,
  parseAppearanceJson,
  parseAppearanceTokens,
  readAppearanceToken,
  validateAppearanceCss,
  type AppearanceCssHost,
  type AppearanceTokens,
} from "../ports/appearance.ts"
import { createAppearanceRefreshHandler } from "../ports/appearance-refresh.ts"
import {
  createScopedAppearance as createAppearance,
  resolveAppearancePaths,
} from "../adapters/appearance-scope.ts"
import { fakeRuntime } from "./_fake-runtime.ts"
import {
  COMPOSED_CSS,
  COMPOSED_CSS_V2,
  GLASS_APPEARANCE_JSON,
  GLASS_MODES_JSON,
  appearanceJsonWith,
  appearanceJsonWithLeaf,
} from "./fixtures/appearances.ts"

const CONFIG_HOME = "/cfg"
const STATE_HOME = "/state"
const CONFIG_DIR = "ags-clipboard"
const PATHS = resolveAppearancePaths(CONFIG_DIR, CONFIG_HOME, STATE_HOME)

/**
 * A fake display that records the CSS text AND the priority the sink passed.
 * The adapter binds the real host to GTK; this fake proves the port contract
 * without a desktop stack.
 */
function fakeDisplay() {
  let nextId = 1
  const installed: Array<{ id: number; css: string; priority: number }> = []
  const allPriorities: number[] = []
  const ops: string[] = []
  let peakInstalled = 0
  const host: AppearanceCssHost = {
    add(css: string, priority: number) {
      const provider = { id: nextId++, css, priority }
      installed.push(provider)
      allPriorities.push(priority)
      ops.push(`add:${provider.id}`)
      peakInstalled = Math.max(peakInstalled, installed.length)
      return provider
    },
    remove(provider) {
      const index = installed.indexOf(provider as { id: number; css: string; priority: number })
      assert.notEqual(index, -1, "the sink removed a provider it did not add")
      const [removed] = installed.splice(index, 1)
      ops.push(`remove:${removed.id}`)
    },
  }
  return {
    host,
    ops,
    installed,
    css: () => installed.map((provider) => provider.css),
    priorities: () => installed.map((provider) => provider.priority),
    allPriorities,
    installedIds: () => installed.map((provider) => provider.id),
    peakInstalled: () => peakInstalled,
  }
}

/** A fake filesystem + host-side watcher registry. */
function fakeFiles(initial: Readonly<Record<string, string>>) {
  const files = new Map(Object.entries(initial))
  const reads: string[] = []
  const watchers: Array<{ path: string; onChange: () => void; active: boolean }> = []
  return {
    readFile(path: string): string | null {
      reads.push(path)
      return files.has(path) ? (files.get(path) as string) : null
    },
    watchFile(path: string, onChange: () => void): () => void {
      const watcher = { path, onChange, active: true }
      watchers.push(watcher)
      return (): void => {
        watcher.active = false
      }
    },
    write(path: string, content: string): void {
      files.set(path, content)
    },
    remove(path: string): void {
      files.delete(path)
    },
    emit(path: string): void {
      for (const watcher of watchers) {
        if (watcher.active && watcher.path === path) watcher.onChange()
      }
    },
    reads,
    watchers,
    activeWatchers: () => watchers.filter((watcher) => watcher.active),
  }
}

function setup(
  overrides: {
    css?: string | null
    tokens?: string | null
  } = {},
) {
  const display = fakeDisplay()
  const files = fakeFiles({
    [PATHS.appearanceCssPath]: overrides.css ?? COMPOSED_CSS,
    [PATHS.tokensPath]: overrides.tokens ?? GLASS_APPEARANCE_JSON,
  })
  if (overrides.css === null) files.remove(PATHS.appearanceCssPath)
  if (overrides.tokens === null) files.remove(PATHS.tokensPath)

  const errors: unknown[] = []
  const appearance = createAppearance({
    configDir: CONFIG_DIR,
    configHome: CONFIG_HOME,
    stateHome: STATE_HOME,
    sink: createReplacingAppearanceCssSink(display.host),
    runtime: fakeRuntime(),
    readFile: files.readFile,
    watchFile: files.watchFile,
    onError: (error) => errors.push(error),
  })
  return { appearance, display, files, errors }
}

test("v2 token documents parse with the five groups and namespaced layout", () => {
  assert.equal(APPEARANCE_VERSION, 2)
  assert.deepEqual(
    [...APPEARANCE_TOKEN_GROUPS],
    ["surface", "state", "type", "ink", "layout"],
  )

  const tokens = parseAppearanceJson(GLASS_APPEARANCE_JSON)
  assert.equal(tokens.version, 2)
  assert.equal(tokens.values["surface.panel.radius"], 18)
  assert.equal(tokens.values["surface.panel.border-width"], 1.5)
  assert.equal(tokens.values["state.selected.fill"], "@primary_container")
  assert.equal(tokens.values["type.size-body"], 12)
  assert.equal(tokens.values["ink.ink-over"], "auto")
  assert.equal(tokens.values["layout.ags.panel-width"], 380)
  assert.equal(tokens.values["layout.ags-clipboard.card-width"], 360)
  assert.equal(tokens.values["layout.ags-notifications.card-width"], 360)

  // The alias is the same parser, not a second vocabulary.
  assert.deepEqual(parseAppearanceTokens(GLASS_APPEARANCE_JSON), tokens)
})

test("mode overrides replace complete groups; omitted groups inherit", () => {
  const dark = parseAppearanceJson(GLASS_MODES_JSON)
  assert.equal(dark.values["ink.accent"], "@primary")
  assert.equal(dark.values["surface.panel.radius"], 18)

  const light = parseAppearanceJson(GLASS_MODES_JSON, "tokens.json", "light")
  assert.equal(light.values["ink.accent"], "@tertiary")
  assert.equal(light.values["ink.ink-dim"], "alpha(@on_surface_variant, 0.6)")
  assert.equal(light.values["surface.panel.radius"], 18, "omitted groups inherit")
  assert.equal(light.mode.light?.["ink.accent"], "@tertiary")
})

test("appearanceValue reads dotted paths and falls back for missing/type-invalid tokens", () => {
  const tokens = parseAppearanceJson(GLASS_APPEARANCE_JSON)

  assert.equal(appearanceValue(tokens, "surface.panel.radius", 0), 18)
  assert.equal(appearanceValue(tokens, "layout.ags.panel-width", 0), 380)
  assert.equal(appearanceValue(tokens, "layout.ags-clipboard.card-width", 0), 360)
  assert.equal(appearanceValue(tokens, "layout.missing.card-width", 320), 320)
  assert.equal(appearanceValue(null, "surface.panel.radius", 12), 12)
  assert.equal(readAppearanceToken(tokens, "surface.panel.radius", 1), 18)
  assert.equal(readAppearanceToken(tokens, "surface.panel.bg", 7), 7)
  assert.equal(
    readAppearanceToken(
      { version: 2, values: { "layout.x.y": "12" }, mode: {} },
      "layout.x.y",
      1,
    ),
    12,
    "a numeric fallback accepts a numeric string",
  )
})

test("the replacing sink applies verbatim at USER priority and adds before removing", () => {
  assert.equal(APPEARANCE_PROVIDER_PRIORITY, 800)
  const display = fakeDisplay()
  const sink = createReplacingAppearanceCssSink(display.host)

  sink.apply("first")
  sink.apply("second")

  assert.deepEqual(display.allPriorities, [800, 800])
  assert.deepEqual(display.priorities(), [800])
  assert.deepEqual(display.ops, ["add:1", "add:2", "remove:1"])
  assert.equal(display.peakInstalled(), 2, "the next provider must coexist with the old one")
  assert.deepEqual(display.css(), ["second"])
})

test("the core installs the composed sheet verbatim and exposes value() on the app", () => {
  const { appearance, display } = setup()

  const radius = appearance.value("surface.panel.radius", 12)
  assert.equal(radius(), 12, "before the first apply the fallback is visible")

  appearance.apply()
  assert.equal(display.installed.length, 1)
  assert.equal(display.css()[0], COMPOSED_CSS, "the composed sheet is applied verbatim")
  assert.equal(display.allPriorities[0], 800)
  assert.equal(radius(), 18)
  assert.equal(radius.peek(), 18)
  assert.equal(appearance.value("layout.ags.panel-width", 0)(), 380)
})

test("only current/appearance is watched and a burst applies one generation once", () => {
  const { appearance, display, files, errors } = setup()

  // Apply the initial generation before subscribing, so the listener count
  // below isolates the rename burst.
  appearance.apply()
  assert.deepEqual(display.ops, ["add:1"])

  const seen: AppearanceTokens[] = []
  const unsubscribe = appearance.subscribe((tokens) => seen.push(tokens))

  assert.deepEqual(
    files.activeWatchers().map((watcher) => watcher.path),
    [PATHS.watchPath],
    "the config appearance.css link is a read path, not a watch path",
  )
  assert.equal(PATHS.watchPath, "/state/dotfiles/current/appearance")
  assert.equal(PATHS.appearanceCssPath, "/cfg/ags-clipboard/appearance.css")
  assert.equal(PATHS.tokensPath, "/state/dotfiles/current/appearance/tokens.json")

  // Simulate one atomic repoint plus the convenience-link creation: several
  // events, one generation, exactly one provider swap.
  files.write(PATHS.appearanceCssPath, COMPOSED_CSS_V2)
  files.emit(PATHS.watchPath)
  files.emit(PATHS.watchPath)
  files.emit(PATHS.watchPath)

  assert.equal(errors.length, 0)
  assert.deepEqual(display.ops, ["add:1", "add:2", "remove:1"])
  assert.equal(display.installed.length, 1)
  assert.match(display.css()[0], /padding: 15px;/)
  assert.equal(seen.length, 1, "listeners run once per generation")

  // Another event for the SAME bytes is not a new generation.
  files.emit(PATHS.watchPath)
  assert.deepEqual(display.ops, ["add:1", "add:2", "remove:1"])
  assert.equal(seen.length, 1)

  unsubscribe()
  assert.equal(files.activeWatchers().length, 0)
})

test("value() updates in place when a later generation changes tokens", () => {
  const { appearance, files } = setup()
  const radius = appearance.value("surface.panel.radius", 12)
  const unsubscribe = appearance.subscribe(() => {})

  appearance.apply()
  assert.equal(radius(), 18)

  files.write(
    PATHS.tokensPath,
    appearanceJsonWithLeaf("surface", "panel", "radius", 24),
  )
  files.emit(PATHS.watchPath)

  assert.equal(radius(), 24)
  assert.equal(radius.peek(), 24)
  unsubscribe()
})

test("missing appearance artifacts are a no-op and keep the value fallback", () => {
  for (const missing of ["css", "tokens"] as const) {
    const { appearance, display, errors } = setup(
      missing === "css" ? { css: null } : { tokens: null },
    )

    appearance.apply()

    assert.equal(display.installed.length, 0, `${missing} missing: no provider`)
    assert.equal(display.ops.length, 0)
    assert.equal(errors.length, 0, "missing is not malformed")
    assert.equal(appearance.value("surface.panel.radius", 12)(), 12)
  }
})

test("a malformed refresh keeps the previous provider and reports through onError", () => {
  const { appearance, display, files, errors } = setup()
  appearance.apply()
  const unsubscribe = appearance.subscribe(() => {})

  files.write(PATHS.tokensPath, "{ not json")
  files.emit(PATHS.watchPath)

  assert.equal(errors.length, 1)
  assert.ok(errors[0] instanceof AppearanceParseError)
  assert.match(String(errors[0]), /invalid JSON/)
  assert.deepEqual(display.ops, ["add:1"], "the previous provider stays installed")
  assert.equal(appearance.tokens().values["surface.panel.radius"], 18)

  files.write(PATHS.tokensPath, GLASS_APPEARANCE_JSON)
  files.write(PATHS.appearanceCssPath, ".x { color: #ff0000; }\n")
  files.emit(PATHS.watchPath)

  assert.equal(errors.length, 2)
  assert.match(String(errors[1]), /literal hex/)
  assert.deepEqual(display.ops, ["add:1"])

  unsubscribe()
})

test("v2 parsing rejects hex, transition, structure/variant, unknown roles and units", () => {
  assert.throws(
    () => parseAppearanceJson(JSON.stringify({ ...JSON.parse(GLASS_APPEARANCE_JSON), version: 1 })),
    /unsupported appearance version/,
  )
  assert.throws(
    () => parseAppearanceJson(appearanceJsonWith("structure", { gap: 4 })),
    /unknown token group|structure\/variant/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "panel", "bg", "#ff0000"),
      ),
    /literal hex/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "panel", "bg", "alpha(@surface, 0.5) transition"),
      ),
    /transition/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "panel", "bg", "@structure_surface"),
      ),
    /unknown palette role/,
  )
  assert.throws(
    () => parseAppearanceJson(appearanceJsonWithLeaf("surface", "panel", "bg", "red")),
    /invalid paint/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "panel", "radius", "18px"),
      ),
    /finite JSON numbers/,
  )
  const glass = JSON.parse(GLASS_APPEARANCE_JSON) as {
    ink: Record<string, unknown>
  }
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWith("ink", { ...glass.ink, "ink-over": "manual" }),
      ),
    /only legal value is "auto"/,
  )
  assert.throws(
    () => parseAppearanceJson(appearanceJsonWith("surface", { panel: {} })),
    /required by the v2 vocabulary/,
  )
  assert.throws(
    () => parseAppearanceJson(appearanceJsonWithLeaf("layout", "ags", "variant", 1)),
    /structure\/variant/,
  )
})

test("composed CSS validation rejects literal hex, transitions and structure props", () => {
  assert.doesNotThrow(() => validateAppearanceCss(COMPOSED_CSS))

  assert.throws(() => validateAppearanceCss(".x { color: #fff; }"), /literal hex/)
  assert.throws(() => validateAppearanceCss(".x { transition: color 1s; }"), /transition/)
  assert.throws(
    () => validateAppearanceCss(".x { transition-property: color; }"),
    /transition/,
  )
  assert.throws(() => validateAppearanceCss(".x { --structure-gap: 4px; }"), /structure\/variant/)
  assert.throws(() => validateAppearanceCss(".x { --variant: dense; }"), /structure\/variant/)
  assert.throws(() => validateAppearanceCss(""), /empty/)
  // The palette block is the one allowed home for hex; a comment is not colour.
  assert.doesNotThrow(() =>
    validateAppearanceCss("/* #ff0000 is a note */ .x { padding: 4px; }"),
  )
})

test("the refresh handler re-applies appearance, runs app work once per hash, and answers JSON", async () => {
  let applies = 0
  const worked: string[] = []
  const responses: string[] = []
  const appearance = {
    apply() {
      applies += 1
    },
  }
  const handler = createAppearanceRefreshHandler(appearance, (hash) => {
    worked.push(hash)
    return { status: "applied" }
  })

  const request = (argv: string[]): void => handler(argv, (response) => responses.push(response))

  request(["palette-refresh", "hash-one"])
  assert.equal(applies, 1, "appearance.apply() runs before app work")
  assert.deepEqual(worked, ["hash-one"])
  assert.equal(responses.length, 1)
  assert.deepEqual(JSON.parse(responses[0]), { ok: true })

  // Same hash: the whole appearance is still re-applied (cheap/coalesced), but
  // the app-owned work is idempotent and does not run again.
  request(["palette-refresh", "hash-one"])
  assert.equal(applies, 2)
  assert.deepEqual(worked, ["hash-one"])
  assert.deepEqual(JSON.parse(responses[1]), { ok: true })

  request(["palette-refresh", "hash-two"])
  assert.equal(applies, 3)
  assert.deepEqual(worked, ["hash-one", "hash-two"])
  assert.deepEqual(JSON.parse(responses[2]), { ok: true })

  // Exactly one response even for a malformed request.
  request(["palette-refresh"])
  assert.equal(responses.length, 4)
  const malformed = JSON.parse(responses[3]) as { ok: boolean; retryable: boolean }
  assert.equal(malformed.ok, false)
  assert.equal(malformed.retryable, false)
})

test("the refresh handler preserves deferred/failed work and does not advance the hash", async () => {
  let applies = 0
  const worked: string[] = []
  let outcome: "deferred" | "failed" | "applied" = "deferred"
  const responses: string[] = []
  const handler = createAppearanceRefreshHandler(
    { apply: () => void (applies += 1) },
    (hash) => {
      worked.push(hash)
      if (outcome === "deferred") return { status: "deferred", reason: "unsaved edits" }
      if (outcome === "failed") return { status: "failed", error: "boom", retryable: true }
      return { status: "applied" }
    },
  )
  const request = (hash: string): void =>
    handler(["palette-refresh", hash], (response) => responses.push(response))

  request("hash-a")
  assert.equal(applies, 1)
  assert.deepEqual(JSON.parse(responses[0]), { ok: true, deferred: "unsaved edits" })

  // A deferred outcome did not advance the hash, so the app work is retried.
  request("hash-a")
  assert.equal(applies, 2)
  assert.equal(worked.length, 2)

  outcome = "failed"
  request("hash-a")
  assert.deepEqual(JSON.parse(responses[2]), { ok: false, error: "boom", retryable: true })
  assert.equal(worked.length, 3)

  outcome = "applied"
  request("hash-a")
  assert.deepEqual(JSON.parse(responses[3]), { ok: true })
  request("hash-a")
  assert.equal(worked.length, 4, "the applied hash is now idempotent")
})

test("the adapter owns one monitor on current/appearance, USER priority and module refs", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const adapter = readFileSync(resolve(root, "adapters/appearance.ts"), "utf8")
  const scope = readFileSync(resolve(root, "adapters/appearance-scope.ts"), "utf8")
  const port = readFileSync(resolve(root, "ports/appearance.ts"), "utf8")

  assert.doesNotMatch(adapter, /\bapply_css\b/)
  assert.doesNotMatch(adapter, /\breset_css\b/)
  assert.doesNotMatch(adapter, /from\s+["']ags\/gtk4\/app["']/)

  assert.equal((adapter.match(/monitor_file\s*\(/g) ?? []).length, 1)
  assert.equal((adapter.match(/GLib\.timeout_add/g) ?? []).length, 1)
  assert.match(adapter, /Gio\.FileMonitorFlags\.WATCH_MOVES/)
  assert.match(adapter, /RELOAD_DEBOUNCE_MS = 50/)
  assert.match(adapter, /const activeMonitors = new Set<Gio\.FileMonitor>\(\)/)
  assert.match(adapter, /activeMonitors\.add\(monitor\)/)
  assert.match(adapter, /activeMonitors\.delete\(monitor\)/)
  assert.match(adapter, /const activeProviders = new Set<CssProviderHandle>\(\)/)
  assert.match(adapter, /APPEARANCE_WATCH_POINTER = "dotfiles\/current\/appearance"/)
  assert.match(adapter, /export function createAppearance\(options: AppearanceAdapterOptions\): Appearance/)
  assert.match(adapter, /export const appearance = createAppearance\(\{ configDir: "ags" \}\)/)

  assert.equal((adapter.match(/add_provider_for_display/g) ?? []).length, 1)
  assert.equal((adapter.match(/remove_provider_for_display/g) ?? []).length, 1)
  assert.match(adapter, /add_provider_for_display\(defaultDisplay\(\), provider, priority\)/)
  assert.doesNotMatch(adapter, /STYLE_PROVIDER_PRIORITY_APPLICATION/)

  // The watch path is the state pointer; the app config link is a read path.
  assert.match(scope, /watchPath: pointer/)
  assert.match(scope, /appearanceCssPath: `\$\{configHome\}\/\$\{configDir\}\/appearance\.css`/)
  assert.match(scope, /tokensPath: `\$\{pointer\}\/tokens\.json`/)
  assert.doesNotMatch(scope, /watchPath:.*appearanceCssPath/)

  assert.match(port, /APPEARANCE_PROVIDER_PRIORITY = 800/)
  assert.match(port, /host\.add\(css, APPEARANCE_PROVIDER_PRIORITY\)/)
})
