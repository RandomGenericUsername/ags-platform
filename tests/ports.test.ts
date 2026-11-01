import { test } from "node:test"
import assert from "node:assert/strict"
import { resolveIconSource, iconByStateKey } from "../ports/icon-source.ts"
import { createNotifier, isCardIntent } from "../ports/notifier.ts"
import { createPreferences } from "../ports/preferences.ts"
import { createTheme } from "../ports/theme.ts"
import { fakeRuntime } from "./_fake-runtime.ts"

test("icon resolution: table -> fallback -> blank", () => {
  const provider = {
    barMappings: () => ({ states: { "wifi-full": "strong" } }),
    resolve: (_g: string, variant: string) =>
      variant === "strong" ? ({ kind: "file", path: "/x.svg" } as const) : null,
  }
  const ref = iconByStateKey<{ key: string }>("network", (s) => s.key)
  assert.deepEqual(resolveIconSource(provider, ref, { key: "wifi-full" }), {
    kind: "file",
    path: "/x.svg",
  })
  assert.equal(resolveIconSource(provider, ref, { key: "" }), null)
})

test("notifier routes keyed/progress intents to the card sink", () => {
  assert.equal(isCardIntent({ summary: "hi" }), false)
  assert.equal(isCardIntent({ summary: "hi", key: "k" }), true)
  const calls: string[] = []
  const notifier = createNotifier({
    notify: () => calls.push("notify"),
    card: () => calls.push("card"),
  })
  notifier.post({ summary: "toast" })
  notifier.post({ summary: "card", key: "k" })
  assert.deepEqual(calls, ["notify", "card"])
})

test("preferences degrade to the fallback and re-read on change", () => {
  const store: Record<string, Record<string, unknown>> = {}
  const hook: { onChange: (() => void) | null } = { onChange: null }
  const prefs = createPreferences(
    {
      read: (ns) => store[ns] ?? null,
      watch: (_ns, cb) => {
        hook.onChange = cb
        return () => {
          hook.onChange = null
        }
      },
    },
    fakeRuntime(),
  )
  const get = prefs.get("capture", "mode", "default")
  assert.equal(get(), "default")
  store.capture = { mode: "video" }
  hook.onChange?.()
  assert.equal(get(), "video")
})

test("theme composes the stable palette artifact with role tokens", () => {
  const applied: string[] = []
  const theme = createTheme({
    legacyCssPath: "/cfg/ags/colors.css",
    palettePath: "/state/dotfiles/current/colors.yaml",
    sink: { apply: (css) => applied.push(css) },
    readFile: (path) =>
      path.endsWith("colors.css")
        ? "@define-color color_01 #ff0000;\n"
        : "primary: '#00ff00'\n",
    watchFile: () => () => {},
  })
  theme.apply()
  assert.equal(applied.length, 1)
  assert.match(applied[0], /^@define-color color_01 #ff0000;/)
  assert.match(applied[0], /@define-color primary #00ff00;/)
  assert.equal(theme.palette().roles.primary, "#00ff00")
})
