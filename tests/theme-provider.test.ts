import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  composeThemeCss,
  createReplacingCssSink,
  createTheme,
  type CssProviderHandle,
  type CssProviderHost,
} from "../ports/theme.ts"
import { PaletteParseError, type Palette } from "../ports/palette.ts"

const LEGACY = "/cfg/ags/colors.css"
const PALETTE = "/state/dotfiles/current/colors.yaml"
const LEGACY_CSS = [
  "/* legacy colors.gtk.css */",
  "@define-color color_background #121318;",
  "@define-color color_01 #ffb4ab;",
  "@define-color color_04 #b9c3ff;",
  "",
].join("\n")
const V1 = [
  "primary: '#b9c3ff'",
  "on_surface: '#e3e1e9'",
  "surface: '#121318'",
  "on_backdrop: '#e3e1e9'",
  "",
].join("\n")
const V2 = [
  "primary: '#ff00aa'",
  "on_surface: '#ffffff'",
  "surface: '#000000'",
  "on_backdrop: '#000000'",
  "",
].join("\n")
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * A fake display: `add`/`remove` record the operation and the CSS text that is
 * installed right now. The sink only ever sees this host, so the replace
 * sequence and the composed sheet are observable without GTK (which the stock
 * test runner cannot load).
 */
function fakeDisplay() {
  let nextId = 1
  const installed: Array<{ id: number; css: string }> = []
  const ops: string[] = []
  let peakInstalled = 0
  const host: CssProviderHost = {
    add(css: string): CssProviderHandle {
      const provider = { id: nextId++, css }
      installed.push(provider)
      ops.push(`add:${provider.id}`)
      peakInstalled = Math.max(peakInstalled, installed.length)
      return provider
    },
    remove(provider: CssProviderHandle): void {
      const index = installed.indexOf(provider as { id: number; css: string })
      assert.notEqual(index, -1, "the sink removed a provider it did not add")
      const [removed] = installed.splice(index, 1)
      ops.push(`remove:${removed.id}`)
    },
  }
  return {
    host,
    ops,
    installed,
    installedIds: () => installed.map((provider) => provider.id),
    css: () => installed.map((provider) => provider.css),
    peakInstalled: () => peakInstalled,
  }
}

/** A fake filesystem + host-side watcher registry. */
function fakeFiles(initial: Readonly<Record<string, string>>) {
  const files = new Map(Object.entries(initial))
  const reads: string[] = []
  const watchers: Array<{ path: string; onChange: () => void; active: boolean }> = []
  return {
    readFile(path: string): string {
      reads.push(path)
      const content = files.get(path)
      if (content === undefined) throw new Error(`ENOENT: ${path}`)
      return content
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

function setup(paletteText = V1) {
  const display = fakeDisplay()
  const files = fakeFiles({ [LEGACY]: LEGACY_CSS, [PALETTE]: paletteText })
  const errors: unknown[] = []
  const theme = createTheme({
    legacyCssPath: LEGACY,
    palettePath: PALETTE,
    sink: createReplacingCssSink(display.host),
    readFile: files.readFile,
    watchFile: files.watchFile,
    onError: (error) => errors.push(error),
  })
  return { display, files, errors, theme }
}

test("the palette sink adds the next provider before removing the previous", () => {
  const { display, theme } = setup()

  theme.apply()
  theme.apply()

  // The second apply installs provider 2 while provider 1 is still on the
  // display, then removes 1. Removing first would leave a frame with no palette.
  assert.deepEqual(display.ops, ["add:1", "add:2", "remove:1"])
  assert.deepEqual(display.installedIds(), [2])
  assert.equal(display.peakInstalled(), 2)
})

test("repeated palette refresh keeps exactly one provider (no accumulation)", () => {
  const { display, theme } = setup()

  for (let i = 0; i < 5; i++) {
    theme.apply()
    assert.equal(
      display.installed.length,
      1,
      `refresh ${i + 1} must leave exactly one palette provider installed`,
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
  assert.equal(display.peakInstalled(), 2, "at most one old provider coexists with the new one")
})

test("the provider applies the legacy colors.css verbatim plus role defines", () => {
  const { display, theme } = setup()

  theme.apply()
  const css = display.css()[0]

  assert.ok(
    css.startsWith(LEGACY_CSS),
    "the legacy stylesheet must remain the byte-identical prefix",
  )
  assert.match(css, /@define-color color_01 #ffb4ab;/)
  assert.match(css, /@define-color color_04 #b9c3ff;/)
  assert.match(css, /@define-color primary #b9c3ff;/)
  assert.match(css, /@define-color on_backdrop #e3e1e9;/)
  assert.equal(composeThemeCss(LEGACY_CSS, null), LEGACY_CSS)
})

test("palette() returns the typed roles from the runtime artifact", () => {
  const { theme } = setup()

  const palette = theme.palette()
  assert.equal(palette.version, "1")
  assert.equal(palette.roles.primary, "#b9c3ff")
  assert.equal(palette.roles.on_backdrop, "#e3e1e9")
  // Cached: repeated reads do not touch the filesystem again.
  assert.equal(theme.palette(), palette)
})

test("subscribe shares ONE monitor and fires after the new palette is loaded", () => {
  const { display, files, theme } = setup()
  theme.apply()

  const seen: Palette[] = []
  const during: Array<string | undefined> = []
  const unsubscribeA = theme.subscribe((palette) => {
    seen.push(palette)
    during.push(theme.palette().roles.primary)
  })
  const unsubscribeB = theme.subscribe((palette) => seen.push(palette))

  assert.equal(files.activeWatchers().length, 1, "both listeners share one monitor")
  assert.deepEqual(files.activeWatchers().map((watcher) => watcher.path), [PALETTE])

  files.write(PALETTE, V2)
  files.emit(PALETTE)

  assert.equal(seen.length, 2, "every listener is notified once")
  for (const palette of seen) {
    assert.equal(palette.roles.primary, "#ff00aa")
    assert.equal(palette.roles.on_backdrop, "#000000")
  }
  assert.deepEqual(during, ["#ff00aa"], "the palette is loaded before listeners run")
  assert.equal(theme.palette().roles.primary, "#ff00aa")
  assert.equal(display.installed.length, 1, "a refresh replaces the provider")
  assert.match(display.css()[0], /@define-color primary #ff00aa;/)

  unsubscribeA()
  unsubscribeB()
})

test("unsubscribe cleans up: the monitor stops with the last listener", () => {
  const { files, theme } = setup()

  const unsubscribeA = theme.subscribe(() => {})
  const unsubscribeB = theme.subscribe(() => {})
  assert.equal(files.activeWatchers().length, 1)

  unsubscribeA()
  assert.equal(files.activeWatchers().length, 1, "one listener still needs the monitor")

  unsubscribeB()
  assert.equal(files.activeWatchers().length, 0, "the last unsubscribe stops the monitor")

  // Idempotent and safe after the monitor is gone.
  unsubscribeB()
  assert.equal(files.activeWatchers().length, 0)

  // A later subscriber starts exactly one new monitor.
  const unsubscribeC = theme.subscribe(() => {})
  assert.equal(files.watchers.length, 2)
  assert.equal(files.activeWatchers().length, 1)
  unsubscribeC()
  assert.equal(files.activeWatchers().length, 0)
})

test("a malformed refresh keeps the previous palette and provider", () => {
  const { display, files, errors, theme } = setup()
  theme.apply()
  const listeners: Palette[] = []
  const unsubscribe = theme.subscribe((palette) => listeners.push(palette))

  files.write(PALETTE, "primary: not-a-hex\n")
  files.emit(PALETTE)

  assert.equal(errors.length, 1)
  assert.ok(errors[0] instanceof PaletteParseError)
  assert.equal(theme.palette().roles.primary, "#b9c3ff")
  assert.deepEqual(listeners, [])
  assert.deepEqual(display.ops, ["add:1"], "no provider is replaced on a failed reload")
  assert.equal(display.installed.length, 1)

  unsubscribe()
})

test("palette() fails closed but apply() still installs the legacy sheet", () => {
  const { display, errors, theme } = setup("surface: '#00'\n")

  assert.throws(
    () => theme.palette(),
    (error: unknown) => {
      assert.ok(error instanceof PaletteParseError)
      assert.match(error.message, /role "surface" has invalid value/)
      return true
    },
  )

  theme.apply()
  assert.equal(errors.length, 1, "the apply path reports the parse failure")
  assert.equal(display.installed.length, 1)
  assert.equal(display.css()[0], LEGACY_CSS, "legacy @color_* apps keep working")
})

test("a throwing listener does not stop the other listeners", () => {
  const { files, errors, theme } = setup()
  const seen: string[] = []
  const unsubscribeA = theme.subscribe(() => {
    throw new Error("listener boom")
  })
  const unsubscribeB = theme.subscribe((palette) => {
    seen.push(palette.roles.primary)
  })

  files.write(PALETTE, V2)
  files.emit(PALETTE)

  assert.deepEqual(seen, ["#ff00aa"])
  assert.equal(errors.length, 1)
  assert.match(String(errors[0]), /listener boom/)

  unsubscribeA()
  unsubscribeB()
})

test("the adapter owns one display provider and one Gio file monitor", () => {
  const source = readFileSync(resolve(root, "adapters/theme.ts"), "utf8")

  // The helper creates, adds and RETAINS a provider per call; routing the
  // palette through it is exactly the accumulation this bug is about.
  assert.doesNotMatch(source, /\bapply_css\b/)
  assert.doesNotMatch(source, /\breset_css\b/)
  assert.doesNotMatch(source, /from\s+["']ags\/gtk4\/app["']/)

  // One add/remove pair, one monitor: the sink can only remove its own handle.
  assert.equal((source.match(/add_provider_for_display/g) ?? []).length, 1)
  assert.equal((source.match(/remove_provider_for_display/g) ?? []).length, 1)
  assert.equal((source.match(/monitor_file\s*\(/g) ?? []).length, 1)
  assert.equal((source.match(/GLib\.timeout_add/g) ?? []).length, 1)
  assert.match(source, /createReplacingCssSink\s*\(/)
  assert.match(source, /load_from_string\s*\(/)
  assert.match(source, /colors\.yaml/)
  assert.match(source, /Gio\.FileMonitorFlags\.WATCH_MOVES/)
})
