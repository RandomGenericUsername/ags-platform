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
import {
  createScopedSkin as createAppSkin,
  resolveAppSkinPaths,
} from "../adapters/skin-scope.ts"
import { fakeRuntime } from "./_fake-runtime.ts"
import { BUILTIN_SKINS, FLAT_SKIN, GLASS_SKIN, PAPER_SKIN } from "./fixtures/skins.ts"

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
  "  background: alpha(@surface, 0.94);",
  "  color: @on_surface;",
  "  padding: 6px;",
  "}",
  "",
].join("\n")

const SKIN_CSS_V2 = [
  ".skin-panel {",
  "  background: alpha(@surface, 0.94);",
  "  color: @on_surface;",
  "  padding: 10px;",
  "}",
  "",
].join("\n")

const SKIN_JSON_TEXT = JSON.stringify(GLASS_SKIN)

function skinJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...GLASS_SKIN, ...overrides })
}

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

const CONFIG_HOME = "/cfg"
const STATE_HOME = "/state"

/**
 * The app-scoped factory core with a fake host. `createAppSkin` in the display
 * adapter supplies the GLib/GTK defaults; this exercises the same path
 * resolution and per-instance wiring without a desktop stack.
 */
function setupApp(
  configDir = "ags-clipboard",
  overrides: {
    skinCss?: string | null
    skinJson?: string | null
    legacy?: string | null
    palette?: string | null
  } = {},
) {
  const paths = resolveAppSkinPaths(configDir, CONFIG_HOME, STATE_HOME)
  const display = fakeDisplay()
  const files = fakeFiles({
    [paths.skinCssPath]: overrides.skinCss ?? SKIN_CSS_TEXT,
    [paths.skinJsonPath]: overrides.skinJson ?? SKIN_JSON_TEXT,
    [paths.legacyCssPath]: overrides.legacy ?? LEGACY_CSS,
    [paths.palettePath]: overrides.palette ?? PALETTE_YAML,
  })
  for (const [path, value] of [
    [paths.skinCssPath, overrides.skinCss],
    [paths.skinJsonPath, overrides.skinJson],
    [paths.legacyCssPath, overrides.legacy],
    [paths.palettePath, overrides.palette],
  ] as const) {
    if (value === null) files.remove(path)
  }
  const errors: unknown[] = []
  const skin = createAppSkin({
    configDir,
    configHome: CONFIG_HOME,
    stateHome: STATE_HOME,
    sink: createReplacingSkinCssSink(display.host),
    readFile: files.readFile,
    watchFile: files.watchFile,
    onError: (error) => errors.push(error),
  })
  return { paths, display, files, errors, skin }
}

/** Build a resolved document with one token replaced. */
function mutated(
  group: keyof typeof GLASS_SKIN,
  name: string,
  value: unknown,
): string {
  const base = GLASS_SKIN as unknown as Record<string, Record<string, unknown>>
  return JSON.stringify({ ...base, [group]: { ...base[group], [name]: value } })
}

test("the three built-in resolved fixtures carry the 24-token v0.6.0 vocabulary and parse", () => {
  assert.deepEqual(
    [...SKIN_TOKEN_GROUPS].sort(),
    ["shape", "surface", "ink", "type", "rhythm", "layout"].sort(),
  )

  for (const [name, fixture] of Object.entries(BUILTIN_SKINS)) {
    const tokens = parseSkinJson(JSON.stringify(fixture), `${name}.json`)
    assert.equal(Object.keys(tokens.values).length, 24, `${name} must resolve 24 tokens`)
    assert.equal(tokens.version, "1")
    assert.equal(typeof tokens.values["shape.hairline-w"], "number")
    assert.equal(typeof tokens.values["shape.border-w"], "number")
    assert.equal(tokens.values["ink.ink-over"], "auto")
    assert.equal(typeof tokens.values["rhythm.cell-pad"], "string")
    assert.equal(typeof tokens.values["type.font-family"], "string")
  }

  // The real glass values that the old group rule rejected.
  const glass = parseSkinJson(JSON.stringify(GLASS_SKIN))
  assert.equal(glass.values["surface.bg-panel"], "alpha(@surface, 0.94)")
  assert.equal(glass.values["surface.shadow"], "none")
  assert.equal(glass.values["surface.blur"], "none")
  assert.equal(glass.values["ink.ink-dim"], "alpha(@on_surface, 0.62)")
  assert.equal(glass.values["ink.ink-over"], "auto")
  assert.equal(glass.values["shape.hairline-w"], 1)

  // flat and paper are real resolved shapes too, not a synthetic subset.
  assert.equal(parseSkinJson(JSON.stringify(FLAT_SKIN)).values["surface.bg-panel"], "transparent")
  assert.equal(
    parseSkinJson(JSON.stringify(PAPER_SKIN)).values["surface.shadow"],
    "0 10px 28px rgba(0,0,0,0.22)",
  )
})

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
  assert.equal(skinTokenValue(skin.tokens(), "ink.ink"), "@on_surface")
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
    skinJson({
      layout: { ...GLASS_SKIN.layout, "panel-width": 420 },
      rhythm: { ...GLASS_SKIN.rhythm, "cell-pad": "9px 10px" },
    }),
  )
  files.emit(SKIN_JSON)

  assert.equal(errors.length, 0)
  assert.equal(seen.length, 2)
  assert.equal(skinTokenValue(skin.tokens(), "panel-width"), 420)
  assert.equal(skinTokenValue(skin.tokens(), "cell-pad"), "9px 10px")
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
  assert.equal(skinTokenValue(skin.tokens(), "panel-width"), 312, "previous tokens are retained")

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
  assert.equal(skinTokenValue(skin.tokens(), "panel-width"), 312)

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
  const spacing = createSkinValue(source, runtime, "cell-pad", "4px 6px")
  const missing = createSkinValue(source, runtime, "chip-min", 12)

  assert.equal(width(), 312, "a bare name resolves its layout token")
  assert.equal(width.peek(), 312)
  assert.equal(spacing(), "8px 9px")
  assert.equal(missing(), 0)

  current = parseSkinJson(
    skinJson({
      layout: { ...GLASS_SKIN.layout, "panel-width": 420 },
      rhythm: { ...GLASS_SKIN.rhythm, "cell-pad": "8px 10px" },
    }),
  )
  emit(current)

  assert.equal(width(), 420, "a reload updates the accessor in place")
  assert.equal(spacing(), "8px 10px")

  // The accessor still defends against type-invalid maps even though the
  // parser no longer produces them.
  current = {
    version: "1",
    values: { "layout.panel-width": "wide", "rhythm.cell-pad": 8 },
  }
  emit(current)

  assert.equal(width(), 300, "a non-numeric value falls back for a numeric accessor")
  assert.equal(spacing(), "4px 6px", "a numeric value falls back for a string accessor")
  assert.equal(missing(), 12, "a removed token falls back")
  assert.equal(readSkinToken(current, "layout.panel-width", 1), 1)
  assert.equal(skinTokenValue(current, "rhythm.cell-pad"), 8)
})

test("numeric tokens are unitless JSON numbers, never length or numeric strings", () => {
  for (const [group, name] of [
    ["shape", "radius-panel"],
    ["shape", "hairline-w"],
    ["rhythm", "gap"],
    ["type", "title-size"],
    ["layout", "panel-width"],
  ] as const) {
    assert.throws(() => parseSkinJson(mutated(group, name, "12px")), /unitless/)
  }

  assert.throws(() => parseSkinJson(mutated("layout", "panel-width", "312")), /unitless/)
  assert.throws(() => parseSkinJson(mutated("shape", "radius-card", -1)), /non-negative/)
  assert.throws(() => parseSkinJson(mutated("shape", "radius-cell", true)), /unitless/)

  // A known numeric token accepted as a JSON number, including a decimal.
  const tokens = parseSkinJson(mutated("shape", "hairline-w", 1.25))
  assert.equal(tokens.values["shape.hairline-w"], 1.25)
})

test("surface paint accepts the real role grammar and rejects hex or arbitrary strings", () => {
  // The four canonical atoms.
  assert.doesNotThrow(() => parseSkinJson(mutated("surface", "bg-panel", "transparent")))
  assert.doesNotThrow(() => parseSkinJson(mutated("surface", "bg-panel", "@surface")))
  assert.doesNotThrow(() => parseSkinJson(mutated("surface", "bg-panel", "alpha(@surface, 0.94)")))
  assert.doesNotThrow(() =>
    parseSkinJson(mutated("surface", "border", "color-mix(in srgb, @outline 60%, transparent)")),
  )

  assert.throws(() => parseSkinJson(mutated("surface", "bg-panel", "#ff0000")), /literal hex/)
  assert.throws(() => parseSkinJson(mutated("surface", "bg-panel", "red")), /invalid paint/)
  assert.throws(() => parseSkinJson(mutated("surface", "bg-panel", "alpha(@surface, 1.2)")), /invalid paint/)
  assert.throws(() =>
    parseSkinJson(mutated("surface", "border", "color-mix(in srgb, @outline 120%, transparent)")),
    /invalid paint/,
  )
  assert.throws(() =>
    parseSkinJson(mutated("surface", "bg-card", "alpha(@surface, 0.5) transition")),
    /transition/,
  )
})

test("shadow and blur use their own grammars", () => {
  // Real paper shadow and the glass/flat none values parse from the fixtures.
  assert.doesNotThrow(() => parseSkinJson(mutated("surface", "shadow", "none")))
  assert.doesNotThrow(() =>
    parseSkinJson(mutated("surface", "shadow", "0 10px 28px rgba(0,0,0,0.22)")),
  )
  assert.doesNotThrow(() =>
    parseSkinJson(mutated("surface", "shadow", "0 8px 24px alpha(@shadow, 0.35)")),
  )
  assert.throws(() => parseSkinJson(mutated("surface", "shadow", "0 1px 2px #000")), /literal hex/)
  assert.throws(() => parseSkinJson(mutated("surface", "shadow", "")), /empty/)

  assert.doesNotThrow(() => parseSkinJson(mutated("surface", "blur", "none")))
  assert.doesNotThrow(() => parseSkinJson(mutated("surface", "blur", "blur(18px)")))
  assert.doesNotThrow(() =>
    parseSkinJson(mutated("surface", "blur", "blur(18px) saturate(1.2)")),
  )
  assert.throws(
    () => parseSkinJson(mutated("surface", "blur", "blur(18px) saturate(120%)")),
    /invalid blur/,
  )
  assert.throws(() => parseSkinJson(mutated("surface", "blur", "blur(18)")), /invalid blur/)
})

test("ink expressions accept roles and alpha; ink-over is exactly auto", () => {
  assert.doesNotThrow(() => parseSkinJson(mutated("ink", "ink", "@on_surface")))
  assert.doesNotThrow(() =>
    parseSkinJson(mutated("ink", "ink-dim", "alpha(@on_surface, 0.62)")),
  )
  assert.doesNotThrow(() => parseSkinJson(mutated("ink", "accent", "alpha(@primary, 1)")))

  assert.throws(() => parseSkinJson(mutated("ink", "ink-over", "manual")), /only legal value is "auto"/)
  assert.throws(() => parseSkinJson(mutated("ink", "ink", "red")), /invalid role expression/)
  assert.throws(() => parseSkinJson(mutated("ink", "ink-dim", "#ffffff")), /literal hex/)
})

test("cell-pad is exactly '<n>px <n>px' and font-family is a non-empty string", () => {
  assert.doesNotThrow(() => parseSkinJson(mutated("rhythm", "cell-pad", "8px 9px")))
  assert.doesNotThrow(() => parseSkinJson(mutated("rhythm", "cell-pad", "0px 0px")))
  assert.throws(() => parseSkinJson(mutated("rhythm", "cell-pad", "8px")), /invalid cell-pad/)
  assert.throws(
    () => parseSkinJson(mutated("rhythm", "cell-pad", "8px 9px 10px")),
    /invalid cell-pad/,
  )
  assert.throws(() => parseSkinJson(mutated("rhythm", "cell-pad", "8 px 9px")), /invalid cell-pad/)

  assert.doesNotThrow(() => parseSkinJson(mutated("type", "font-family", "inherit")))
  assert.doesNotThrow(() =>
    parseSkinJson(mutated("type", "font-family", 'system-ui, "Cantarell", sans-serif')),
  )
  assert.throws(() => parseSkinJson(mutated("type", "font-family", " ")), /empty/)
  assert.throws(() => parseSkinJson(mutated("type", "font-family", "Inter #fff")), /literal hex/)
})

test("skin parsing rejects structure/variant/transition names and unknown tokens", () => {
  assert.throws(
    () => parseSkinJson(JSON.stringify({ structure: { gap: 4 } })),
    /structure\/variant groups/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ variant: { dense: true } })),
    /structure\/variant groups/,
  )
  assert.throws(
    () => parseSkinJson(mutated("layout", "variant", "dense")),
    /structure\/variant tokens/,
  )
  assert.throws(
    () => parseSkinJson(mutated("surface", "bg-panel-variant", "@surface")),
    /structure\/variant tokens/,
  )
  assert.throws(
    () => parseSkinJson(mutated("rhythm", "transition-speed", "fast")),
    /transition tokens/,
  )
  assert.throws(
    () => parseSkinJson(mutated("shape", "radius", 4)),
    /unknown shape token/,
  )
  assert.throws(
    () => parseSkinJson(mutated("layout", "app-additive-token", 4)),
    /unknown layout token/,
  )
  assert.throws(
    () => parseSkinJson(JSON.stringify({ "bad group": { a: 1 } })),
    /unknown token group/,
  )
  assert.throws(
    () => parseSkinJson(mutated("shape", "Radius", 4)),
    /kebab-case/,
  )
  assert.throws(() => parseSkinJson("{"), /invalid JSON/)
  assert.throws(() => parseSkinJson("{}"), /no skin tokens/)
})

test("role expressions accept bare and alpha forms and reject literal hex and non-role values", () => {
  assert.equal(isRoleExpression("@on_surface"), true)
  assert.equal(isRoleExpression(" @on_backdrop "), true)
  assert.equal(isRoleExpression("alpha(@on_surface, 0.62)"), true)
  assert.equal(isRoleExpression("alpha(@on_surface, 1.2)"), false)
  assert.equal(isRoleExpression("#e3e1e9"), false)
  assert.equal(isRoleExpression("on_surface"), false)
  assert.equal(validateRoleExpression("@primary", "skin.json"), "@primary")
  assert.equal(
    validateRoleExpression("alpha(@primary, 0.5)", "skin.json"),
    "alpha(@primary, 0.5)",
  )

  assert.throws(() => validateRoleExpression("#ff0000"), /literal hex/)
  assert.throws(() => validateRoleExpression("var(--on-surface)"), /invalid role expression/)
  assert.throws(
    () => parseSkinJson(JSON.stringify({ ink: { ink: "red" } })),
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

test("the app factory resolves per-configDir CSS and the shared token/palette artifacts", () => {
  const clipboard = resolveAppSkinPaths("ags-clipboard", CONFIG_HOME, STATE_HOME)
  const notifications = resolveAppSkinPaths("ags-notifications", CONFIG_HOME, STATE_HOME)

  assert.deepEqual(clipboard, {
    skinCssPath: "/cfg/ags-clipboard/skin.css",
    skinJsonPath: "/state/dotfiles/current/skin.json",
    legacyCssPath: "/cfg/ags/colors.css",
    palettePath: "/state/dotfiles/current/colors.yaml",
  })
  assert.equal(
    notifications.skinCssPath,
    "/cfg/ags-notifications/skin.css",
    "the CSS pointer is scoped by configDir",
  )
  assert.notEqual(clipboard.skinCssPath, notifications.skinCssPath)
  assert.equal(
    clipboard.skinJsonPath,
    notifications.skinJsonPath,
    "skin.json is one shared token map",
  )
  assert.equal(clipboard.legacyCssPath, notifications.legacyCssPath)
  assert.equal(clipboard.palettePath, notifications.palettePath)

  const app = setupApp("ags-clipboard")
  app.skin.apply()
  assert.deepEqual(
    [...new Set(app.files.reads)].sort(),
    [
      app.paths.skinCssPath,
      app.paths.skinJsonPath,
      app.paths.legacyCssPath,
      app.paths.palettePath,
    ].sort(),
  )
  assert.equal(app.display.installed.length, 1)
})

test("two app-scoped instances own their providers and monitors", () => {
  const paths = resolveAppSkinPaths("ags-clipboard", CONFIG_HOME, STATE_HOME)
  const files = fakeFiles({
    [paths.skinCssPath]: SKIN_CSS_TEXT,
    [paths.skinJsonPath]: SKIN_JSON_TEXT,
    [paths.legacyCssPath]: LEGACY_CSS,
    [paths.palettePath]: PALETTE_YAML,
  })
  const displayA = fakeDisplay()
  const displayB = fakeDisplay()
  const errors: unknown[] = []
  const options = {
    configDir: "ags-clipboard",
    configHome: CONFIG_HOME,
    stateHome: STATE_HOME,
    readFile: files.readFile,
    watchFile: files.watchFile,
    onError: (error: unknown) => errors.push(error),
  }
  const a = createAppSkin({
    ...options,
    sink: createReplacingSkinCssSink(displayA.host),
  })
  const b = createAppSkin({
    ...options,
    sink: createReplacingSkinCssSink(displayB.host),
  })

  a.apply()
  b.apply()
  assert.equal(displayA.installed.length, 1)
  assert.equal(displayB.installed.length, 1)
  assert.notEqual(displayA.host, displayB.host)

  // Refreshing one instance never touches the other's provider.
  a.apply()
  assert.deepEqual(displayA.ops, ["add:1", "add:2", "remove:1"])
  assert.deepEqual(displayB.ops, ["add:1"])

  const seenA: SkinTokens[] = []
  const seenB: SkinTokens[] = []
  const unsubscribeA = a.subscribe((tokens) => seenA.push(tokens))
  const unsubscribeB = b.subscribe((tokens) => seenB.push(tokens))
  assert.equal(files.activeWatchers().length, 4, "two instances keep two monitors each")

  unsubscribeA()
  assert.equal(files.activeWatchers().length, 2, "the surviving instance keeps its monitors")

  files.write(paths.skinCssPath, SKIN_CSS_V2)
  files.emit(paths.skinCssPath)

  assert.equal(errors.length, 0)
  assert.deepEqual(seenA, [], "the released instance's listener never runs")
  assert.equal(seenB.length, 1, "the live instance still reloads")
  assert.match(displayB.css()[0], /padding: 10px;/)
  assert.deepEqual(displayA.ops, ["add:1", "add:2", "remove:1"])

  unsubscribeB()
  assert.equal(files.activeWatchers().length, 0)
})

test("an app-scoped skin composes the palette block and installs at USER priority", () => {
  const app = setupApp("ags-clipboard")

  app.skin.apply()
  const css = app.display.css()[0]

  assert.equal(SKIN_PROVIDER_PRIORITY, 800)
  assert.deepEqual(app.display.allPriorities, [800])
  assert.ok(css.startsWith(LEGACY_CSS), "the legacy palette sheet is the prefix")
  assert.match(css, /@define-color on_surface #e3e1e9;/)
  assert.ok(
    css.indexOf("@define-color on_surface") < css.indexOf("color: @on_surface"),
    "the palette role block must precede the app's skin CSS",
  )
  assert.equal(skinTokenValue(app.skin.tokens(), "panel-width"), 312)
})

test("an app-scoped skin treats missing artifacts as a no-op", () => {
  for (const missing of ["skinCss", "skinJson"] as const) {
    const app = setupApp(
      "ags-clipboard",
      missing === "skinCss" ? { skinCss: null } : { skinJson: null },
    )

    app.skin.apply()

    assert.equal(app.display.installed.length, 0)
    assert.equal(app.display.ops.length, 0)
    assert.equal(app.errors.length, 0)
    assert.equal(readSkinToken(app.skin.tokens(), "panel-width", 300), 300)
  }
})

test("the app-scoped accessor reads and updates its own instance", () => {
  const app = setupApp("ags-clipboard")
  const runtime = fakeRuntime()
  const width = createSkinValue(app.skin, runtime, "layout.panel-width", 300)

  app.skin.apply()
  assert.equal(width(), 312)

  const seen: SkinTokens[] = []
  const unsubscribe = app.skin.subscribe((tokens) => seen.push(tokens))

  app.files.write(
    app.paths.skinJsonPath,
    skinJson({
      layout: { ...GLASS_SKIN.layout, "panel-width": 420 },
    }),
  )
  app.files.emit(app.paths.skinJsonPath)

  assert.equal(width(), 420)
  assert.equal(seen.length, 1)
  unsubscribe()
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

  // The bar singleton is just the app factory with configDir "ags"; non-bar
  // apps build their own instance and use the app-scoped accessor.
  assert.match(adapter, /export function createAppSkin\(options: AppSkinOptions\): Skin/)
  assert.match(adapter, /export const skin = createAppSkin\(\{ configDir: "ags" \}\)/)
  assert.match(
    adapter,
    /export function createAppSkinValue<T extends SkinTokenValue>\(\s*source: Skin,\s*key: string,\s*fallback: T,?\s*\): ReadAccessor<T>/,
  )
  assert.match(adapter, /createSkinValue\(source, agsRuntime, key, fallback\)/)
  assert.match(adapter, /skinValue<T extends SkinTokenValue>/)
  assert.match(adapter, /createAppSkinValue\(skin, key, fallback\)/)

  // The app path resolver is pure (no gi://), so node --test can exercise it.
  const scope = readFileSync(resolve(root, "adapters/skin-scope.ts"), "utf8")
  assert.doesNotMatch(scope, /\bfrom\s+["']gi:\/\//)
  assert.match(scope, /skinCssPath: `\$\{configHome\}\/\$\{configDir\}\/skin\.css`/)
  assert.match(scope, /skinJsonPath: `\$\{stateHome\}\/dotfiles\/current\/skin\.json`/)
})
