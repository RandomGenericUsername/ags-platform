---
id: REQ-005
title: "One event client (hub + job control + mandatory restart contract)"
kind: requirement
status: proposed
lane: 2
links:
  openspec: one-event-client
  bmad: none
worktree: none
branch: none
---

# One event client (hub + job control + mandatory restart contract)

## Requirement

Move the `DomainEventBusCore` state machine (subscribe-before-read hydration + `(epoch, seq)` dedup) into the platform with an injected `EventBusTransport`, and expose `EventHub` with `control(jobId, action)`. The **restart/hydration contract is mandatory**: every consumer resets on `JobsCleared(epoch)` and treats `(0, 0)` hydration as "no state yet". This one client replaces the four full copies + two bespoke notification readers.

Source: spine **AD-5**, **AD-6**; doc 101 §13.4; sweep evidence (4 `DomainEventBusCore` copies + 2 bespoke).

## Acceptance

- [ ] `EventSource.subscribe` returns an unsubscribe handle; `EventHub.select` returns a reactive accessor.
- [ ] A restart resets every subscribed consumer (test: emit `JobsCleared`, assert reset + re-hydrate).
- [ ] No app carries its own copy of the state machine (grep → one implementation).
