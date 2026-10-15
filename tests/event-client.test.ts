import { test } from "node:test"
import assert from "node:assert/strict"
import {
  DomainEventBusCore,
  asUint,
  isNewer,
  parseTopicState,
  type EventBusTransport,
} from "../ports/event-client.ts"
import { fakeRuntime } from "./_fake-runtime.ts"

/** A scripted transport: no bus, no Gio. */
class FakeTransport implements EventBusTransport {
  private onDomainEvent!: (params: unknown[]) => void
  state: Record<string, unknown> | null = null
  controls: Array<[string, string]> = []
  startSignals(onDomainEvent: (params: unknown[]) => void): void {
    this.onDomainEvent = onDomainEvent
  }
  getTopicState(): Record<string, unknown> | null {
    return this.state
  }
  control(jobId: string, action: string): void {
    this.controls.push([jobId, action])
  }
  emit(topic: string, seq: number, epoch: number, payload: unknown): void {
    this.onDomainEvent([topic, "", seq, epoch, payload])
  }
}

test("isNewer compares (epoch, seq) lexicographically", () => {
  assert.equal(isNewer(undefined, 0, 0), false)
  assert.equal(isNewer([1, 5], 1, 4), false)
  assert.equal(isNewer([1, 5], 1, 6), true)
  assert.equal(isNewer([1, 5], 2, 0), true)
})

test("parseTopicState splits reserved members from the payload", () => {
  assert.deepEqual(parseTopicState({ _epoch: 2, _seq: 7, state: "done" }), {
    epoch: 2,
    seq: 7,
    payload: { state: "done" },
  })
  assert.deepEqual(parseTopicState(null), { epoch: 0, seq: 0, payload: {} })
  assert.equal(asUint(-1), 0)
  assert.equal(asUint(3.9), 3)
})

test("subscribe hydrates the current topic state before any signal", () => {
  const transport = new FakeTransport()
  transport.state = { _epoch: 1, _seq: 3, state: "done" }
  const bus = new DomainEventBusCore(transport)
  const seen: unknown[] = []
  bus.subscribe("speedtest.state", (_t, payload) => seen.push(payload))
  assert.deepEqual(seen, [{ state: "done" }])
})

test("select is reactive and rejects stale deliveries", () => {
  const transport = new FakeTransport()
  const bus = new DomainEventBusCore(transport, fakeRuntime())
  const selected = bus.select("speedtest.state")
  assert.equal(selected(), null)
  transport.emit("speedtest.state", 1, 1, { state: "starting" })
  assert.deepEqual(selected(), { state: "starting" })
  transport.emit("speedtest.state", 1, 0, { state: "stale" }) // seq 0 < 1
  assert.deepEqual(selected(), { state: "starting" })
})

test("control routes through the injected transport", () => {
  const transport = new FakeTransport()
  const bus = new DomainEventBusCore(transport)
  bus.control("job-1", "cancel")
  assert.deepEqual(transport.controls, [["job-1", "cancel"]])
})
