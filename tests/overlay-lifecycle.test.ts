import { test } from "node:test"
import assert from "node:assert/strict"
import {
  contentSignature,
  createOverlayLifecycle,
  type OverlayScheduler,
} from "../ports/overlay-lifecycle.ts"

/**
 * A hand-drained scheduler: `defer` only queues, so "deferred" is observable and
 * the ordering between the synchronous map path and the idle callback is exactly
 * what the tests assert.
 */
function stubScheduler() {
  const queue: Array<() => void> = []
  const scheduler: OverlayScheduler = { defer: (task) => queue.push(task) }
  return {
    scheduler,
    pending: () => queue.length,
    drain: () => {
      // Take a snapshot: a callback that reschedules must not loop here.
      for (const task of queue.splice(0)) task()
    },
  }
}

/** Records the hook order and lets a test mutate the "current" signature. */
function harness(initialKey: string) {
  const log: string[] = []
  const built: string[] = []
  let key = initialKey
  const hooks = {
    present: () => log.push("present"),
    hydrate: () => log.push("hydrate"),
    build: () => {
      log.push("build")
      built.push(key)
    },
    key: () => key,
  }
  return { hooks, log, built, setKey: (next: string) => (key = next) }
}

test("contentSignature joins parts with a newline", () => {
  assert.equal(contentSignature([]), "")
  assert.equal(contentSignature(["text:aa", "image:bb"]), "text:aa\nimage:bb")
})

test("open presents and hydrates synchronously, then defers the build", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.open()
  // On the map path: present first, then the cheap hydrate; the heavy build is
  // NOT run yet.
  assert.deepEqual(h.log, ["present", "hydrate"])
  assert.equal(s.pending(), 1)
  assert.deepEqual(h.built, [])

  s.drain()
  assert.deepEqual(h.log, ["present", "hydrate", "build"])
  assert.deepEqual(h.built, ["A"])
  assert.equal(life.builtKey, "A")
})

test("an unchanged reopen skips the rebuild entirely (warm path)", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.open()
  s.drain()
  life.close()

  life.open() // same signature
  assert.deepEqual(h.log, ["present", "hydrate", "build", "present", "hydrate"])
  assert.equal(s.pending(), 0, "unchanged content must not even queue an idle")
  assert.deepEqual(h.built, ["A"])
})

test("changed content rebuilds on the next open", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.open()
  s.drain()
  life.close()

  h.setKey("B")
  life.open()
  assert.equal(s.pending(), 1)
  s.drain()
  assert.deepEqual(h.built, ["A", "B"])
  assert.equal(life.builtKey, "B")
})

test("the idle callback re-checks: content changed between map and idle builds the NEW key", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.open() // gate saw "A" (builtKey null), so it queued
  h.setKey("B") // a live push lands before the idle runs
  s.drain()
  assert.deepEqual(h.built, ["B"])
  assert.equal(life.builtKey, "B")
})

test("the idle callback re-checks: content already rebuilt between map and idle is skipped", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.open() // queues an idle for "A"
  life.refresh() // a live push rebuilds "A" synchronously first
  assert.deepEqual(h.built, ["A"])
  s.drain() // the stale idle must not build again
  assert.deepEqual(h.built, ["A"])
})

test("an unmap between map and idle cancels the deferred build", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.open()
  life.close()
  s.drain()
  assert.deepEqual(h.built, [])
  assert.equal(life.builtKey, null)
})

test("refresh while unmapped is a no-op", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.close() // never opened
  h.setKey("B")
  life.refresh()
  assert.deepEqual(h.built, [])
  assert.deepEqual(h.log, [])
})

test("refresh with unchanged content skips the rebuild", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.open()
  s.drain()
  life.refresh() // same signature
  assert.deepEqual(h.built, ["A"])
})

test("a re-entrant refresh during build does not double-build", () => {
  const s = stubScheduler()
  const h = harness("A")
  // `build` re-enters refresh(); because builtKey is marked BEFORE build, the
  // re-entrant call sees the content as already current.
  const life = createOverlayLifecycle(
    {
      ...h.hooks,
      build: () => {
        h.hooks.build()
        life.refresh()
      },
    },
    s.scheduler,
  )

  life.open()
  s.drain()
  assert.deepEqual(h.built, ["A"])
})

test("two maps without an unmap build once", () => {
  const s = stubScheduler()
  const h = harness("A")
  const life = createOverlayLifecycle(h.hooks, s.scheduler)

  life.open()
  life.open() // e.g. a remap before the first idle ran
  assert.equal(s.pending(), 2)
  s.drain()
  assert.deepEqual(h.built, ["A"])
})
