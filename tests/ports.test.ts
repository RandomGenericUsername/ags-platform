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

test("theme applies the stable palette pointer", () => {
  const applied: string[] = []
  createTheme("/cfg/ags/colors.css", { apply: (p) => applied.push(p) }).apply()
  assert.deepEqual(applied, ["/cfg/ags/colors.css"])
})
