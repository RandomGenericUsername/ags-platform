import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  createReplacingCssSink,
  createTheme,
  type CssProviderHandle,
  type CssProviderHost,
} from "../ports/theme.ts"

const PALETTE = "/cfg/ags/colors.css"
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * A fake display: `add`/`remove` record the operation and the providers that
 * are installed right now. The sink only ever sees this host, so the replace
 * sequence is observable without GTK (which the stock test runner cannot load).
 * A handle is opaque to the sink; the fake gives it an id so ops are readable.
 */
function fakeDisplay() {
  let nextId = 1
  const installed: Array<{ id: number; path: string }> = []
  const ops: string[] = []
  let peakInstalled = 0
  const host: CssProviderHost = {
    add(path: string): CssProviderHandle {
      const provider = { id: nextId++, path }
      installed.push(provider)
      ops.push(`add:${provider.id}`)
      peakInstalled = Math.max(peakInstalled, installed.length)
      return provider
    },
    remove(provider: CssProviderHandle): void {
      const index = installed.indexOf(provider as { id: number; path: string })
      assert.notEqual(index, -1, "the sink removed a provider it did not add")
      const [removed] = installed.splice(index, 1)
      ops.push(`remove:${removed.id}`)
    },
  }
  return {
    host,
    ops,
    installed: () => installed.map((provider) => provider.id),
    peakInstalled: () => peakInstalled,
  }
}

test("the palette sink adds the next provider before removing the previous", () => {
  const display = fakeDisplay()
  const theme = createTheme(PALETTE, createReplacingCssSink(display.host))

  theme.apply()
  theme.apply()

  // The second apply installs provider 2 while provider 1 is still on the
  // display, then removes 1. Removing first would leave a frame with no palette.
  assert.deepEqual(display.ops, ["add:1", "add:2", "remove:1"])
  assert.deepEqual(display.installed(), [2])
  assert.equal(display.peakInstalled(), 2)
})

test("repeated palette refresh keeps exactly one provider (no accumulation)", () => {
  const display = fakeDisplay()
  const theme = createTheme(PALETTE, createReplacingCssSink(display.host))

  for (let i = 0; i < 5; i++) {
    theme.apply()
    assert.equal(
      display.installed().length,
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
  assert.deepEqual(display.installed(), [5])
  assert.equal(display.peakInstalled(), 2, "at most one old provider coexists with the new one")
})

test("the adapter does not route the palette through the AGS app CSS helper", () => {
  const source = readFileSync(resolve(root, "adapters/theme.ts"), "utf8")

  // The helper creates, adds and RETAINS a provider per call; routing the
  // palette through it is exactly the accumulation this bug is about.
  assert.doesNotMatch(source, /\bapply_css\b/)
  assert.doesNotMatch(source, /\breset_css\b/)
  assert.doesNotMatch(source, /from\s+["']ags\/gtk4\/app["']/)

  // The adapter owns one add/remove pair, so it can remove only its own
  // provider and leave the app stylesheet and GTK theme untouched.
  assert.equal((source.match(/add_provider_for_display/g) ?? []).length, 1)
  assert.equal((source.match(/remove_provider_for_display/g) ?? []).length, 1)
  assert.match(source, /createReplacingCssSink\s*\(/)
})
