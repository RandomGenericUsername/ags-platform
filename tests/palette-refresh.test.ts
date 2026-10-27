import { test } from "node:test"
import assert from "node:assert/strict"
import {
  PALETTE_REFRESH_COMMAND,
  createPaletteRefreshHandler,
  type PaletteRefresh,
  type PaletteRefreshResult,
} from "../ports/palette-refresh.ts"

const ARGV = [PALETTE_REFRESH_COMMAND, "appearance-abc"]

/** One AGS request response channel. Every `respond` call is recorded raw. */
function responder() {
  const raw: string[] = []
  return {
    raw,
    respond: (response: string) => raw.push(response),
    body: () => raw.map((response) => JSON.parse(response) as Record<string, unknown>),
  }
}

/** Let queued promise callbacks (and any badly scheduled follow-up) run. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test("applied returns exactly one JSON string, after the refresh completed", async () => {
  const seen: string[] = []
  const handler = createPaletteRefreshHandler((hash) => {
    seen.push(hash)
    return { status: "applied" }
  })
  const res = responder()

  handler([...ARGV], res.respond)

  assert.deepEqual(seen, ["appearance-abc"])
  assert.equal(res.raw.length, 1)
  assert.equal(typeof res.raw[0], "string", "the AGS transport requires a string")
  assert.deepEqual(res.body(), [{ ok: true }])
  assert.equal("deferred" in res.body()[0], false, "applied is not scheduled work")

  // No follow-up response or deferred work may appear after ok:true.
  await flush()
  assert.equal(res.raw.length, 1)
})

test("deferred carries a non-empty reason and never claims applied", () => {
  const handler = createPaletteRefreshHandler(() => ({
    status: "deferred",
    reason: "waiting for an unsaved-edit commit",
  }))
  const res = responder()

  handler([...ARGV], res.respond)

  assert.equal(res.raw.length, 1)
  assert.deepEqual(res.body(), [
    { ok: true, deferred: "waiting for an unsaved-edit commit" },
  ])
})

test("busy is the protocol's retryable failure, not a queue", () => {
  const handler = createPaletteRefreshHandler(() => ({ status: "busy" }))
  const res = responder()

  handler([...ARGV], res.respond)

  assert.deepEqual(res.body(), [{ ok: false, error: "busy", retryable: true }])
})

test("a concurrent request gets busy while the first refresh is in flight", async () => {
  let release: ((result: PaletteRefreshResult) => void) | undefined
  let calls = 0
  const handler = createPaletteRefreshHandler(() => {
    calls += 1
    return new Promise<PaletteRefreshResult>((resolve) => {
      release = resolve
    })
  })
  const first = responder()
  const second = responder()

  handler([...ARGV], first.respond)
  handler([...ARGV], second.respond)

  assert.equal(calls, 1, "busy must not start a second refresh")
  assert.equal(first.raw.length, 0, "the in-flight request stays unanswered until it settles")
  assert.deepEqual(second.body(), [{ ok: false, error: "busy", retryable: true }])

  release?.({ status: "applied" })
  await flush()

  assert.deepEqual(first.body(), [{ ok: true }])
  assert.equal(first.raw.length, 1, "the first request is answered exactly once")
  assert.equal(second.raw.length, 1)
})

test("a declared failed result keeps its retryable/terminal distinction", () => {
  const retryable = createPaletteRefreshHandler(() => ({
    status: "failed",
    error: "palette file not ready",
    retryable: true,
  }))
  const retryableRes = responder()
  retryable([...ARGV], retryableRes.respond)
  assert.deepEqual(retryableRes.body(), [
    { ok: false, error: "palette file not ready", retryable: true },
  ])

  const terminal = createPaletteRefreshHandler(() => ({
    status: "failed",
    error: "manifest instance does not match",
    retryable: false,
  }))
  const terminalRes = responder()
  terminal([...ARGV], terminalRes.respond)
  assert.deepEqual(terminalRes.body(), [
    { ok: false, error: "manifest instance does not match", retryable: false },
  ])
})

test("a thrown error becomes one retryable failure, never an unanswered request", () => {
  const handler = createPaletteRefreshHandler(() => {
    throw new Error("palette read failed")
  })
  const res = responder()

  handler([...ARGV], res.respond)

  assert.equal(res.raw.length, 1)
  assert.deepEqual(res.body(), [
    { ok: false, error: "palette read failed", retryable: true },
  ])
})

test("a rejected async refresh becomes one retryable failure", async () => {
  const handler = createPaletteRefreshHandler(async () => {
    throw new Error("theme apply failed")
  })
  const res = responder()

  handler([...ARGV], res.respond)
  assert.equal(res.raw.length, 0)

  await flush()
  assert.equal(res.raw.length, 1)
  assert.deepEqual(res.body(), [
    { ok: false, error: "theme apply failed", retryable: true },
  ])
})

test("malformed argv is a terminal failure and never invokes the refresh", () => {
  let calls = 0
  const handler = createPaletteRefreshHandler(() => {
    calls += 1
    return { status: "applied" }
  })

  const malformed: string[][] = [
    [],
    [PALETTE_REFRESH_COMMAND],
    [PALETTE_REFRESH_COMMAND, ""],
    [PALETTE_REFRESH_COMMAND, "appearance-abc", "extra"],
    ["other-command", "appearance-abc"],
  ]

  for (const argv of malformed) {
    const res = responder()
    handler(argv, res.respond)
    assert.equal(res.raw.length, 1, `${JSON.stringify(argv)} must get exactly one response`)
    const body = res.body()[0]
    assert.equal(body.ok, false)
    assert.match(String(body.error), /malformed/i)
    assert.equal(body.retryable, false)
  }

  assert.equal(calls, 0)
})

test("object responses are rejected and replaced with a terminal JSON string", () => {
  const invalid: unknown[] = [
    { ok: true },
    { status: "applied", deferred: "not allowed together" },
    { status: "deferred", reason: "" },
    { status: "failed", error: "", retryable: true },
    { status: "failed", error: "no retryable" },
    null,
  ]

  for (const value of invalid) {
    const handler = createPaletteRefreshHandler(
      (() => value) as unknown as PaletteRefresh,
    )
    const res = responder()
    handler([...ARGV], res.respond)

    assert.equal(res.raw.length, 1)
    assert.equal(typeof res.raw[0], "string")
    const body = res.body()[0]
    assert.equal(body.ok, false, `${JSON.stringify(value)} must not pass through`)
    assert.match(String(body.error), /invalid/i)
    assert.equal(body.retryable, false)
  }
})
