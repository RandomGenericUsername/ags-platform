import { test } from "node:test"
import assert from "node:assert/strict"
import {
  CAPTURE_CLUSTER_COMMAND,
  CAPTURE_CLUSTER_VERSION,
  encodeClusterResponse,
  parseClusterRequest,
  validateClusterRequest,
  type ClusterAnchor,
  type ClusterRequest,
} from "../ports/capture-cluster.ts"

const anchor: ClusterAnchor = {
  connector: "eDP-1",
  monitorX: 0,
  monitorY: 0,
  monitorWidth: 1920,
  monitorHeight: 1080,
  scale: 1,
  x: 1546,
  y: 10,
  width: 76,
  height: 38,
  edge: "top",
}

function show(overrides: Partial<ClusterRequest> = {}): ClusterRequest {
  return {
    v: CAPTURE_CLUSTER_VERSION,
    command: "show",
    seq: 7,
    compact: true,
    anchor,
    ...overrides,
  }
}

test("the command and version are the published literals", () => {
  assert.equal(CAPTURE_CLUSTER_COMMAND, "capture-cluster")
  assert.equal(CAPTURE_CLUSTER_VERSION, 1)
})

test("a show request round-trips through JSON and keeps its anchor", () => {
  const parsed = parseClusterRequest(
    JSON.stringify(
      show({
        observed: { phase: "recording", jobId: "job-1", elapsedSeconds: 12 },
        labels: { pause: "Hold" },
      }),
    ),
  )
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.deepEqual(parsed.request.anchor, anchor)
  assert.deepEqual(parsed.request.observed, {
    phase: "recording",
    jobId: "job-1",
    elapsedSeconds: 12,
  })
  assert.deepEqual(parsed.request.labels, { pause: "Hold" })
})

test("hide and popover-close are valid without an anchor", () => {
  for (const command of ["hide", "popover-close"] as const) {
    const parsed = validateClusterRequest({
      v: 1,
      command,
      seq: 3,
      compact: false,
    })
    assert.equal(parsed.ok, true)
    if (parsed.ok) assert.equal(parsed.request.command, command)
  }
})

test("show and update require a positive slot", () => {
  for (const command of ["show", "update"] as const) {
    const parsed = validateClusterRequest({
      v: 1,
      command,
      seq: 1,
      compact: true,
    })
    assert.deepEqual(parsed, {
      ok: false,
      error: "bad-request",
      detail: `${command} requires an anchor`,
    })
  }
})

test("a malformed slot is rejected instead of producing a window at 0x0", () => {
  const parsed = validateClusterRequest(
    show({ anchor: { ...anchor, width: 0 } }),
  )
  assert.equal(parsed.ok, false)
  if (!parsed.ok) assert.equal(parsed.error, "bad-request")
})

test("unsupported versions are distinguishable from malformed requests", () => {
  const parsed = validateClusterRequest({
    v: 2,
    command: "show",
    seq: 1,
    compact: true,
    anchor,
  })
  assert.equal(parsed.ok, false)
  if (!parsed.ok) assert.equal(parsed.error, "unsupported-version")
})

test("invalid JSON and unknown fields are terminal bad requests", () => {
  for (const raw of [
    "{",
    "",
    JSON.stringify({ ...show(), extra: true }),
    JSON.stringify({ ...show(), anchor: { ...anchor, extra: true } }),
    JSON.stringify({ ...show(), observed: { phase: "recording", extra: 1 } }),
    JSON.stringify({ ...show(), labels: { loud: "x" } }),
    JSON.stringify({ ...show(), seq: -1 }),
    JSON.stringify({ ...show(), seq: 1.5 }),
    JSON.stringify({ ...show(), command: "open" }),
  ]) {
    const parsed = parseClusterRequest(raw)
    assert.equal(parsed.ok, false, raw)
    if (!parsed.ok) assert.equal(parsed.error, "bad-request", raw)
  }
})

test("an observed hint accepts null job ids and rejects invalid numbers", () => {
  const good = validateClusterRequest(
    show({ observed: { phase: "idle", jobId: null, elapsedSeconds: 0 } }),
  )
  assert.equal(good.ok, true)

  const bad = validateClusterRequest(
    show({ observed: { phase: "idle", elapsedSeconds: -1 } }),
  )
  assert.equal(bad.ok, false)
})

test("responses encode to exactly one JSON string", () => {
  assert.equal(encodeClusterResponse({ ok: true }), '{"ok":true}')
  assert.equal(
    encodeClusterResponse({ ok: false, error: "bad-request", retryable: false }),
    '{"ok":false,"error":"bad-request","retryable":false}',
  )
})
