---
id: REQ-005
title: "One event client (hub + job control + mandatory restart contract)"
kind: requirement
status: done
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

Source: spine **AD-5**, **AD-6**; doc 101 §13.4; sweep evidence (4 `DomainEventBusCore` copies + 2 bespoke). Execution: dotfiles-v3 change `one-event-client` (merged at `d843d672`).

## Acceptance

- [x] `EventSource.subscribe`/`onRestart` return unsubscribe handles; `EventHub.select<T>` returns a reactive accessor; `control` is first-class (`platform/event-client.ts`; `event-client.test.ts`, 11 tests). ✅
- [x] A restart resets every subscribed consumer (test: `JobsCleared` → accessor `null` during restart → re-hydrated). ✅
- [~] The bar carries one client (`platform/event-client.ts`); the 4 app-local copies (`src/gui-tools/**`) + 2 bespoke readers are replaced when the apps migrate — **ags-apps epic**, not here. ✅ (bar scope)
- [x] Gates green: `make ags-test` (108), `make ags-typecheck` PASS, `make bar-typecheck` OK, `make gates-ci` exit 0, `make deploy-coverage` PASS. ✅
