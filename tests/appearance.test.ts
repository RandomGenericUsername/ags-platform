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
} from "../ports/appearance.ts"
import { fakeRuntime } from "./_fake-runtime.ts"
import {
  COMPOSED_CSS,
  GLASS_APPEARANCE_JSON,
  GLASS_MODES_JSON,
  appearanceJsonWith,
  appearanceJsonWithLeaf,
} from "./fixtures/appearances.ts"

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

test("v2 token documents parse with the five groups and namespaced layout", () => {
  assert.equal(APPEARANCE_VERSION, 2)
  assert.deepEqual(
    [...APPEARANCE_TOKEN_GROUPS],
    ["surface", "state", "type", "ink", "layout"],
  )

  const tokens = parseAppearanceJson(GLASS_APPEARANCE_JSON)
  assert.equal(tokens.version, 2)
  assert.equal(tokens.values["surface.window.bg"], "alpha(@surface, 0.94)")
  assert.equal(tokens.values["surface.window.border"], "@primary")
  assert.equal(tokens.values["surface.window.border-width"], 1.5)
  assert.equal(tokens.values["surface.window.radius"], 12)
  assert.equal(tokens.values["surface.window.padding"], 11)
  assert.equal(tokens.values["surface.window.shadow"], "none")
  assert.equal(tokens.values["surface.window.blur"], "none")
  assert.equal(tokens.values["surface.window.opacity"], 0.94)
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

test("surface.window is required with exactly the eight v0.12.0 tokens", () => {
  const tokens = parseAppearanceJson(GLASS_APPEARANCE_JSON)
  // Surface.window is a distinct role: it is not the panel value copied over.
  assert.notEqual(
    tokens.values["surface.window.radius"],
    tokens.values["surface.panel.radius"],
  )

  const withoutWindow = JSON.parse(GLASS_APPEARANCE_JSON) as {
    surface: Record<string, unknown>
  }
  delete withoutWindow.surface.window
  assert.throws(
    () => parseAppearanceJson(JSON.stringify(withoutWindow)),
    /required by the v2 vocabulary/,
    "the window group is required; panel never stands in for it",
  )

  const missingOpacity = JSON.parse(GLASS_APPEARANCE_JSON) as {
    surface: { window: Record<string, unknown> }
  }
  delete missingOpacity.surface.window.opacity
  assert.throws(
    () => parseAppearanceJson(JSON.stringify(missingOpacity)),
    /required by the v2 vocabulary/,
  )

  assert.throws(
    () => parseAppearanceJson(appearanceJsonWithLeaf("surface", "window", "glow", 1)),
    /unknown appearance token/,
    "the window role is a closed object",
  )

  // The other five surface roles still parse unchanged and are not aliased.
  const withoutPanel = JSON.parse(GLASS_APPEARANCE_JSON) as {
    surface: Record<string, unknown>
  }
  delete withoutPanel.surface.panel
  assert.throws(
    () => parseAppearanceJson(JSON.stringify(withoutPanel)),
    /required by the v2 vocabulary/,
    "window never aliases the panel role either",
  )
})

test("surface.window.opacity is a unitless number in [0, 1]", () => {
  for (const opacity of [0, 0.5, 1]) {
    assert.equal(
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "opacity", opacity),
      ).values["surface.window.opacity"],
      opacity,
    )
  }
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "opacity", "0.94"),
      ),
    /finite JSON numbers/,
    "a unit-bearing/string opacity is not a number",
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "opacity", "94%"),
      ),
    /finite JSON numbers/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "opacity", -0.01),
      ),
    />= 0/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "opacity", 1.01),
      ),
    /<= 1/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "opacity", null),
      ),
    /finite JSON numbers/,
  )
})

test("the other window tokens keep the existing token kinds and rules", () => {
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "bg", "#ff0000"),
      ),
    /literal hex/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "border", "red"),
      ),
    /unknown palette role|invalid role value/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "radius", "12px"),
      ),
    /finite JSON numbers/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "blur", "blur(4)"),
      ),
    /invalid blur/,
  )
  assert.throws(
    () =>
      parseAppearanceJson(
        appearanceJsonWithLeaf("surface", "window", "shadow", "#shadow"),
      ),
    /literal hex/,
  )
  assert.doesNotThrow(() =>
    parseAppearanceJson(
      appearanceJsonWithLeaf("surface", "window", "blur", "blur(6px) saturate(1.1)"),
    ),
  )
})

test("a complete mode.dark/light surface override validates the window role", () => {
  const base = JSON.parse(GLASS_APPEARANCE_JSON) as {
    surface: Record<string, Record<string, unknown>>
  }
  const lightSurface = {
    ...base.surface,
    window: { ...base.surface.window, opacity: 0.7 },
  }
  const document = JSON.stringify({
    ...base,
    mode: { light: { surface: lightSurface } },
  })

  const light = parseAppearanceJson(document, "tokens.json", "light")
  assert.equal(light.values["surface.window.opacity"], 0.7)
  assert.equal(light.mode.light?.["surface.window.opacity"], 0.7)

  const broken = JSON.stringify({
    ...base,
    mode: {
      light: {
        surface: {
          ...base.surface,
          window: { ...base.surface.window, opacity: 2 },
        },
      },
    },
  })
  assert.throws(() => parseAppearanceJson(broken, "tokens.json", "light"), /<= 1/)
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

test("createAppearanceValue updates in place when the source publishes a new map", () => {
  let current = parseAppearanceJson(GLASS_APPEARANCE_JSON)
  const listeners: Array<(tokens: typeof current) => void> = []
  const source = {
    tokens: () => current,
    subscribe: (listener: (tokens: typeof current) => void) => {
      listeners.push(listener)
      return () => {}
    },
  }
  const radius = createAppearanceValue(source, fakeRuntime(), "surface.panel.radius", 12)
  assert.equal(radius(), 18)

  current = parseAppearanceJson(
    appearanceJsonWithLeaf("surface", "panel", "radius", 24),
  )
  for (const listener of listeners) listener(current)
  assert.equal(radius(), 24)
  assert.equal(radius.peek(), 24)
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
        appearanceJsonWithLeaf("surface", "panel", "bg", "#not-an-id"),
      ),
    /literal hex/,
    "token values keep the any-# prohibition; the CSS literal rule is separate",
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

test("composed CSS validation accepts ID selectors and url() fragments", () => {
  assert.doesNotThrow(() =>
    validateAppearanceCss(
      "window#notifications-window { color: @on_surface; }",
    ),
  )
  assert.doesNotThrow(() => validateAppearanceCss(".x#id { padding: 4px; }"))
  assert.doesNotThrow(() =>
    validateAppearanceCss(".x#not-an-id { padding: 4px; }"),
  )
  assert.doesNotThrow(() =>
    validateAppearanceCss(".x { background-image: url(#gradient); }"),
  )
  assert.doesNotThrow(() =>
    validateAppearanceCss(".x { background-image: url(#abcdef); }"),
    "a hex-shaped url() fragment is a reference, not a colour atom",
  )
  assert.doesNotThrow(() =>
    validateAppearanceCss(
      [
        "@define-color surface #121318;",
        "@define-color on_surface #e3e1e9;",
        "",
        "window#notifications-window {",
        "  color: @on_surface;",
        "  background-image: url(#gradient);",
        "}",
      ].join("\n"),
    ),
  )
})

test("composed CSS validation rejects only 3/4/6/8-digit hex colour literals", () => {
  for (const hex of ["#fff", "#ffffff", "#ffffffff", "#1234"]) {
    assert.throws(
      () => validateAppearanceCss(`.x { color: ${hex}; }`),
      /literal hex/,
      `${hex} outside @define-color is a literal colour`,
    )
  }
  assert.throws(
    () => validateAppearanceCss(".x { border-color: #ABC; }"),
    /literal hex/,
    "hex detection is case-insensitive",
  )
  assert.doesNotThrow(() =>
    validateAppearanceCss(".x { color: #12345; }"),
    "5- and 7-digit runs are not CSS hex colours",
  )
  assert.doesNotThrow(() =>
    validateAppearanceCss(".x { color: #fffff; }"),
    "a non-colour hash token is not a literal hex colour",
  )
})

test("the generated ags-notifications sheet validates (ID selector regression)", () => {
  const fixture = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/ags-notifications.css"),
    "utf8",
  )
  assert.match(fixture, /window#notifications-window \{/)
  assert.equal((fixture.match(/@define-color\s/g) ?? []).length, 125)
  assert.doesNotThrow(() => validateAppearanceCss(fixture, "ags-notifications.css"))
})

test("the adapter owns one monitor on current, USER priority and module refs", () => {
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
  assert.match(adapter, /APPEARANCE_WATCH_POINTER = "dotfiles\/current"/)
  assert.match(adapter, /export function createAppearance\(options: AppearanceAdapterOptions\): Appearance/)
  assert.match(adapter, /export const appearance = createAppearance\(\{ configDir: "ags" \}\)/)

  assert.equal((adapter.match(/add_provider_for_display/g) ?? []).length, 1)
  assert.equal((adapter.match(/remove_provider_for_display/g) ?? []).length, 1)
  assert.match(adapter, /add_provider_for_display\(defaultDisplay\(\), provider, priority\)/)
  assert.doesNotMatch(adapter, /STYLE_PROVIDER_PRIORITY_APPLICATION/)

  // State-only reads: no XDG_CONFIG_HOME convenience link and no v1/v2 skin.
  assert.doesNotMatch(adapter, /get_user_config_dir/)
  assert.doesNotMatch(scope, /configHome|XDG_CONFIG_HOME|skin\.css|skin\.json/)
  assert.match(port, /watchFile\(paths\.currentPath, reload\)/)
  assert.match(port, /generationsPath/)
  assert.match(port, /manifestPath/)
  assert.doesNotMatch(port, /appearanceCssPath: `\$\{configHome\}/)
  assert.match(port, /APPEARANCE_PROVIDER_PRIORITY = 800/)
  assert.match(port, /host\.add\(css, APPEARANCE_PROVIDER_PRIORITY\)/)
})
