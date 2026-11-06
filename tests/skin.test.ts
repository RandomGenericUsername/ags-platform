import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  SKIN_PROVIDER_PRIORITY,
  SKIN_TOKEN_GROUPS,
  SkinParseError,
  composeSkinCss,
  createReplacingSkinCssSink,
  createSkin,
  createSkinValue,
  isRoleExpression,
  parseSkinJson,
  readSkinToken,
  skinTokenValue,
  validateRoleExpression,
  validateSkinCss,
  type SkinCssHost,
  type SkinTokenSource,
  type SkinTokens,
} from "../ports/skin.ts"
import { composeThemeCss } from "../ports/theme.ts"
import { fakeRuntime } from "./_fake-runtime.ts"

const SKIN_CSS = "/cfg/ags/skin.css"
const SKIN_JSON = "/state/dotfiles/current/skin.json"
const LEGACY = "/cfg/ags/colors.css"
const PALETTE = "/state/dotfiles/current/colors.yaml"

const LEGACY_CSS = [
  "/* legacy colors.gtk.css */",
  "@define-color color_background #121318;",
  "@define-color color_04 #b9c3ff;",
  "",
].join("\n")

const PALETTE_YAML = [
  "primary: '#b9c3ff'",
  "on_surface: '#e3e1e9'",
  "surface: '#121318'",
  "surface_container: '#1e1f25'",
  "on_backdrop: '#e3e1e9'",
  "",
].join("\n")

const SKIN_CSS_TEXT = [
  ".skin-panel {",
  "  background: @surface_container;",
  "  color: @on_surface;",
  "  padding: 6px;",
  "}",
  "",
].join("\n")

const SKIN_CSS_V2 = [
  ".skin-panel {",
  "  background: @surface_container;",
  "  color: @on_surface;",
  "  padding: 10px;",
  "}",
  "",
].join("\n")

function skinJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: "1",
    shape: { radius: "12px" },
    surface: { panel: "@surface_container" },
    ink: { text: "@on_surface" },
    type: { "body-size": "13px" },
    rhythm: { "space-1": "6px" },
    layout: {
      "panel-width": 360,
      "bt-list-spacing": "6px",
      "bar-row-height": 34,
      "chip-min": 24,
    },
    ...overrides,
  })
}

const SKIN_JSON_TEXT = skinJson()

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
  const host: SkinCssHost = {
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
    skinCss?: string | null
    skinJson?: string | null
    legacy?: string | null
    palette?: string | null
  } = {},
) {
  const display = fakeDisplay()
  const files = fakeFiles({
    [SKIN_CSS]: overrides.skinCss ?? SKIN_CSS_TEXT,
    [SKIN_JSON]: overrides.skinJson ?? SKIN_JSON_TEXT,
    [LEGACY]: overrides.legacy ?? LEGACY_CSS,
    [PALETTE]: overrides.palette ?? PALETTE_YAML,
  })
  for (const [path, value] of [
    [SKIN_CSS, overrides.skinCss],
    [SKIN_JSON, overrides.skinJson],
    [LEGACY, overrides.legacy],
    [PALETTE, overrides.palette],
  ] as const) {
    if (value === null) files.remove(path)
  }
  const errors: unknown[] = []
  const skin = createSkin({
    skinCssPath: SKIN_CSS,
    skinJsonPath: SKIN_JSON,
    legacyCssPath: LEGACY,
    palettePath: PALETTE,
    sink: createReplacingSkinCssSink(display.host),
    readFile: files.readFile,
    watchFile: files.watchFile,
    onError: (error) => errors.push(error),
  })
  return { display, files, errors, skin }
}

test("the composed provider contains the palette block before the skin CSS", () => {
  const { display, skin } = setup()

  skin.apply()
  const css = display.css()[0]

  // Legacy remains the byte-identical prefix; role defines follow it.
  assert.ok(css.startsWith(LEGACY_CSS))
  assert.match(css, /@define-color on_surface #e3e1e9;/)
  assert.match(css, /@define-color surface_container #1e1f25;/)

  // The known ink token is a role expression and the role is defined BEFORE
  // the skin uses it, so it resolves instead of painting near-black.
  assert.equal(skinTokenValue(skin.tokens(), "ink.text"), "@on_surface")
  assert.ok(
    css.indexOf("@define-color on_surface") < css.indexOf("color: @on_surface"),
    "the palette role block must precede the skin CSS",
  )
  assert.match(css, /color:\s*@on_surface;/)
})

test("composeSkinCss keeps the palette block first and is total", () => {
  const palette = composeThemeCss(LEGACY_CSS, {
    version: "1",
    roles: { on_surface: "#e3e1e9", surface_container: "#1e1f25" },
  })
  const composed = composeSkinCss(palette, SKIN_CSS_TEXT)

  assert.ok(composed.startsWith(LEGACY_CSS))
  assert.ok(composed.indexOf("@define-color on_surface") < composed.indexOf(".skin-panel"))
  assert.equal(composeSkinCss("", "skin"), "skin")
  assert.equal(composeSkinCss("palette", ""), "palette")
  assert.equal(composeSkinCss("palette", "skin"), "palette\nskin")
  assert.equal(composeSkinCss("palette\n", "skin"), "palette\nskin")
})

test("the replacing sink passes USER priority (800) on every add", () => {
  const { display, skin } = setup()

  skin.apply()
  skin.apply()

  assert.equal(SKIN_PROVIDER_PRIORITY, 800)
  assert.deepEqual(display.allPriorities, [800, 800])
  assert.deepEqual(display.priorities(), [800])

  const seen: number[] = []
  const sink = createReplacingSkinCssSink({
    add: (_css, priority) => {
      seen.push(priority)
      return {}
    },
    remove: () => {},
  })
  sink.apply("first")
  assert.deepEqual(seen, [800])
})

test("the skin provider is added before the previous one is removed", () => {
  const { display, skin } = setup()

  for (let i = 0; i < 5; i++) {
    skin.apply()
    assert.equal(
      display.installed.length,
      1,
      `refresh ${i + 1} must leave exactly one skin provider installed`,
    )
  }

  assert.deepEqual(display.ops, [
    "add:1",
    "add:2", "remove:1",
    "add:3", "remove:2",
    "add:4", "remove:3",
    "add:5", "remove:4",
  ])
  assert.deepEqual(display.installedIds(), [5])
  assert.equal(display.peakInstalled(), 2, "the new provider must coexist with the old one")
})

test("subscribe shares one watcher per artifact and releases both on the last unsubscribe", () => {
  const { files, skin } = setup()

  const unsubscribeA = skin.subscribe(() => {})
  const unsubscribeB = skin.subscribe(() => {})

  assert.equal(files.activeWatchers().length, 2, "one watcher for skin.css and one for skin.json")
  assert.deepEqual(
    files.activeWatchers().map((watcher) => watcher.path).sort(),
    [SKIN_CSS, SKIN_JSON].sort(),
  )

  unsubscribeA()
  assert.equal(files.activeWatchers().length, 2, "one listener still needs both watchers")

  unsubscribeB()
  assert.equal(files.activeWatchers().length, 0, "the last unsubscribe stops both watchers")

  // Idempotent and safe after release.
  unsubscribeB()
  assert.equal(files.activeWatchers().length, 0)

  // A later subscriber starts one watcher per artifact again.
  const unsubscribeC = skin.subscribe(() => {})
  assert.equal(files.watchers.length, 4)
  assert.equal(files.activeWatchers().length, 2)
  unsubscribeC()
  assert.equal(files.activeWatchers().length, 0)
})

test("reloads the composed sheet when either skin artifact changes", () => {
  const { display, files, errors, skin } = setup()
  skin.apply()
  const seen: SkinTokens[] = []
  const unsubscribe = skin.subscribe((tokens) => seen.push(tokens))

  files.write(SKIN_CSS, SKIN_CSS_V2)
  files.emit(SKIN_CSS)

  assert.equal(errors.length, 0)
  assert.equal(display.installed.length, 1, "a reload replaces the provider")
  assert.match(display.css()[0], /padding: 10px;/)
  assert.match(display.css()[0], /@define-color on_surface #e3e1e9;/)
  assert.equal(seen.length, 1, "listeners run after the new sheet is installed")

  files.write(
    SKIN_JSON,
    skinJson({ layout: { "panel-width": 420, "bt-list-spacing": "9px" } }),
  )
  files.emit(SKIN_JSON)

  assert.equal(errors.length, 0)
  assert.equal(seen.length, 2)
  assert.equal(skinTokenValue(skin.tokens(), "panel-width"), 420)
  assert.equal(skinTokenValue(skin.tokens(), "bt-list-spacing"), "9px")
  assert.match(display.css()[0], /padding: 10px;/, "the last skin.css is retained")

  unsubscribe()
})

test("missing skin artifacts are a no-op and leave the app fallback CSS alone", () => {
  for (const missing of ["skinCss", "skinJson"] as const) {
    const { display, errors, skin } = setup(
      missing === "skinCss" ? { skinCss: null } : { skinJson: null },
    )

    skin.apply()

    assert.equal(display.installed.length, 0, `${missing} missing: no provider may be installed`)
    assert.equal(display.ops.length, 0)
    assert.equal(errors.length, 0, "missing is not a malformed artifact")
    assert.equal(skinTokenValue(skin.tokens(), "panel-width"), undefined)
    assert.equal(readSkinToken(skin.tokens(), "panel-width", 300), 300)
  }
})

test("removing a previously loaded artifact keeps the previous provider", () => {
  const { display, files, errors, skin } = setup()
  skin.apply()
  const seen: SkinTokens[] = []
  const unsubscribe = skin.subscribe((tokens) => seen.push(tokens))

  files.remove(SKIN_JSON)
  files.emit(SKIN_JSON)

  assert.equal(display.installed.length, 1, "the previous provider stays installed")
  assert.deepEqual(display.ops, ["add:1"])
  assert.equal(errors.length, 0)
  assert.deepEqual(seen, [])
  assert.equal(skinTokenValue(skin.tokens(), "panel-width"), 360, "previous tokens are retained")

  unsubscribe()
})

test("a malformed refresh keeps the previous provider and reports the error", () => {
  const { display, files, errors, skin } = setup()
  skin.apply()
  const seen: SkinTokens[] = []
  const unsubscribe = skin.subscribe((tokens) => seen.push(tokens))

  files.write(SKIN_JSON, "{ not json")
  files.emit(SKIN_JSON)

  assert.equal(errors.length, 1)
  assert.ok(errors[0] instanceof SkinParseError)
  assert.match(String(errors[0]), /invalid JSON/)
  assert.deepEqual(display.ops, ["add:1"], "no provider is replaced on a failed reload")
  assert.equal(display.installed.length, 1)
  assert.deepEqual(seen, [])
  assert.equal(skinTokenValue(skin.tokens(), "panel-width"), 360)

  // Restore the token map, then prove a literal hex in skin CSS is likewise
  // rejected before it reaches GTK.
  files.write(SKIN_JSON, SKIN_JSON_TEXT)
  files.write(SKIN_CSS, ".skin-panel { color: #ff0000; }\n")
  files.emit(SKIN_CSS)

  assert.equal(errors.length, 2)
  assert.match(String(errors[1]), /literal hex/)
  assert.deepEqual(display.ops, ["add:1"])

  unsubscribe()
})

test("an unparsable initial skin is a reported no-op", () => {
  const { display, errors, skin } = setup({ skinJson: "surface: not-json\n" })

  skin.apply()

  assert.equal(display.installed.length, 0)
  assert.equal(errors.length, 1)
  assert.ok(errors[0] instanceof SkinParseError)
})

test("the token accessor falls back for missing and invalid tokens and updates in place", () => {
  const runtime = fakeRuntime()
  let current: SkinTokens | null = parseSkinJson(SKIN_JSON_TEXT)
  const listeners = new Set<(tokens: SkinTokens) => void>()
  const source: SkinTokenSource = {
    tokens: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const emit = (tokens: SkinTokens): void => {
    for (const listener of [...listeners]) listener(tokens)
  }

  const width = createSkinValue(source, runtime, "panel-width", 300)
  const spacing = createSkinValue(source, runtime, "bt-list-spacing", "4px")
  const missing = createSkinValue(source, runtime, "chip-min", 12)

  assert.equal(width(), 360, "a bare name resolves its layout token")
  assert.equal(width.peek(), 360)
  assert.equal(spacing(), "6px")
  assert.equal(missing(), 24)

  current = parseSkinJson(
    skinJson({ layout: { "panel-width": "wide", "bt-list-spacing": "8px" } }),
  )
  emit(current)

  assert.equal(width(), 300, "a non-numeric value falls back for a numeric accessor")
  assert.equal(spacing(), "8px", "a reload updates the accessor in place")
  assert.equal(missing(), 12, "a removed token falls back")

  current = parseSkinJson(skinJson({ layout: { "bt-list-spacing": 8 } }))
  emit(current)

  assert.equal(spacing(), "4px", "a numeric value falls back for a string accessor")
  assert.equal(readSkinToken(current, "layout.panel-width", 1), 1)
  assert.equal(skinTokenValue(current, "layout.bt-list-spacing"), 8)
})

test("skin parsing rejects literal hex, structure/variant and transition tokens", () => {
  assert.throws(
    () => parseSkinJson(JSON.stringify({ surface: { panel: "#123456" } })),
    (error: unknown) => {
      assert.ok(error instanceof SkinParseError)
      assert.match(String(error), /literal hex/)
      return true
    },
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ structure: { gap: "4px" } })),
    /structure\/variant groups/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ variant: { dense: true } })),
    /structure\/variant groups/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ layout: { variant: "dense" } })),
    /structure\/variant tokens/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ rhythm: { "transition-speed": "fast" } })),
    /transition tokens/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ type: { body: "#fff" } })),
    /literal hex/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ "bad group": { a: 1 } })),
    /unknown token group/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ shape: { Radius: "4px" } })),
    /kebab-case/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ shape: { radius: -1 } })),
    /non-negative/,
  )
  assert.throws(() => parseSkinJson("{"), /invalid JSON/)
  assert.throws(() => parseSkinJson("{}"), /no skin tokens/)
})

test("role expressions reject literal hex and non-role values", () => {
  assert.equal(isRoleExpression("@on_surface"), true)
  assert.equal(isRoleExpression(" @on_backdrop "), true)
  assert.equal(isRoleExpression("#e3e1e9"), false)
  assert.equal(isRoleExpression("on_surface"), false)
  assert.equal(validateRoleExpression("@primary", "skin.json"), "@primary")

  assert.throws(() => validateRoleExpression("#ff0000"), /literal hex/)
  assert.throws(() => validateRoleExpression("var(--on-surface)"), /invalid role expression/)
  assert.throws(
    () => parseSkinJson(JSON.stringify({ ink: { text: "red" } })),
    /invalid role expression/,
  )
})

test("skin CSS validation rejects literal hex, transitions and structure/variant props", () => {
  assert.doesNotThrow(() =>
    validateSkinCss(".x { color: @on_surface; background: @surface_container; }\n"),
  )

  assert.throws(() => validateSkinCss(".x { color: #fff; }"), /literal hex/)
  assert.throws(() => validateSkinCss(".x { transition: color 1s; }"), /transition/)
  assert.throws(() => validateSkinCss(".x { transition-property: color; }"), /transition/)
  assert.throws(() => validateSkinCss(".x { --structure-gap: 4px; }"), /structure\/variant/)
  assert.throws(() => validateSkinCss(".x { --variant: dense; }"), /structure\/variant/)
  assert.throws(() => validateSkinCss(""), /empty/)
  // A comment is not a literal colour.
  assert.doesNotThrow(() => validateSkinCss("/* #ff0000 is a note */ .x { padding: 4px; }"))
})

test("parseSkinJson accepts the declared groups, numbers, version and additive tokens", () => {
  const tokens = parseSkinJson(
    JSON.stringify({
      version: 1,
      shape: { radius: "12px", "radius-pill": 999 },
      surface: { panel: "@surface_container" },
      ink: { text: "@on_surface" },
      type: { "body-size": "13px", weight: 600 },
      rhythm: { "space-1": 4 },
      layout: { "panel-width": "420", "app-additive-token": "keep-me" },
    }),
    "fixture.json",
  )

  assert.equal(tokens.version, "1")
  assert.deepEqual(tokens.values["shape.radius"], "12px")
  assert.equal(tokens.values["layout.panel-width"], "420")
  assert.equal(tokens.values["layout.app-additive-token"], "keep-me")
  assert.equal(Object.isFrozen(tokens), true)
  assert.equal(Object.isFrozen(tokens.values), true)
  assert.deepEqual(
    [...SKIN_TOKEN_GROUPS].sort(),
    ["shape", "surface", "ink", "type", "rhythm", "layout"].sort(),
  )
})

test("the adapter owns USER priority, module-scoped refs and one debounced monitor per artifact", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const adapter = readFileSync(resolve(root, "adapters/skin.ts"), "utf8")
  const port = readFileSync(resolve(root, "ports/skin.ts"), "utf8")

  // The AGS app CSS helper retains a provider per call and installs at USER;
  // routing the skin through it would both accumulate and let the app win.
  assert.doesNotMatch(adapter, /\bapply_css\b/)
  assert.doesNotMatch(adapter, /\breset_css\b/)
  assert.doesNotMatch(adapter, /from\s+["']ags\/gtk4\/app["']/)

  // One add/remove pair, one host priority argument, no APPLICATION constant.
  assert.equal((adapter.match(/add_provider_for_display/g) ?? []).length, 1)
  assert.equal((adapter.match(/remove_provider_for_display/g) ?? []).length, 1)
  assert.match(adapter, /add_provider_for_display\(defaultDisplay\(\), provider, priority\)/)
  assert.doesNotMatch(adapter, /STYLE_PROVIDER_PRIORITY_APPLICATION/)

  // One monitor creation per watched artifact; the module-scoped sets retain
  // the monitors/providers that a local would lose to GC.
  assert.equal((adapter.match(/monitor_file\s*\(/g) ?? []).length, 1)
  assert.equal((adapter.match(/GLib\.timeout_add/g) ?? []).length, 1)
  assert.match(adapter, /Gio\.FileMonitorFlags\.WATCH_MOVES/)
  assert.match(adapter, /const activeMonitors = new Set<Gio\.FileMonitor>\(\)/)
  assert.match(adapter, /activeMonitors\.add\(monitor\)/)
  assert.match(adapter, /activeMonitors\.delete\(monitor\)/)
  assert.match(adapter, /const activeProviders = new Set<CssProviderHandle>\(\)/)
  assert.match(adapter, /RELOAD_DEBOUNCE_MS = 50/)

  // The port supplies the literal 800 and the sink forwards it.
  assert.match(port, /SKIN_PROVIDER_PRIORITY = 800/)
  assert.match(port, /host\.add\(css, SKIN_PROVIDER_PRIORITY\)/)

  // The two artifacts are constants, not ad-hoc paths in widgets.
  assert.match(adapter, /SKIN_CSS_POINTER = "ags\/skin\.css"/)
  assert.match(adapter, /SKIN_JSON_POINTER = "dotfiles\/current\/skin\.json"/)
  assert.match(adapter, /skinValue<T extends SkinTokenValue>/)
  assert.match(adapter, /createSkinValue\(skin, agsRuntime/)
})
