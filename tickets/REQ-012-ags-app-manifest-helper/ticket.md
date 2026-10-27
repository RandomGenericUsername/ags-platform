---
id: REQ-012
title: "AGS app manifest helper, palette-refresh handler helper and template conformance"
kind: requirement
status: proposed
lane: 3
links:
  openspec: none
  bmad: none
worktree: none
branch: none
---

# AGS app manifest helper, palette-refresh handler helper and template conformance

## Requirement

Add the app-side TypeScript seam for the standalone AGS app contract:

- exported types for `app.manifest.json` (matching contracts REQ-009);
- a `palette-refresh` handler helper that wraps an app refresh function, accepts
  the appearance hash, returns exactly one JSON-encoded string response
  (`{"ok":true}`, `{"ok":true,"deferred":"..."}` or
  `{"ok":false,"error":"...","retryable":bool}`), and never leaves the AGS
  request without a response;
- a template-conformance helper/gate that app repos can invoke to validate the
  required repository files, manifest shape, live-handler presence and ticket
  flow;
- tests and docs for the helper.

This is app-side policy-free infrastructure: no app-specific paths or behavior.

## Acceptance

- [ ] Manifest types match the contracts schema and are exported from the package.
- [ ] The handler helper returns one JSON string, exactly once, on every path
      (success, deferred, busy, error), and rejects object responses.
- [ ] The helper preserves the app's state contract; it does not restart or
      mutate app state itself.
- [ ] The template-conformance helper checks the required repo files, manifest
      identity/shape, handler for live mode and ticket flow.
- [ ] Unit tests cover success/deferred/busy/error and template pass/fail.
- [ ] The package exports and CI gates are updated; no app-specific policy enters
      the platform.
- [ ] The Theme one-provider fix (BUG-001) is a dependency for any live refresh
      use.

## Dependencies

- `contracts` REQ-009 schemas/protocol.
- `ags-platform` BUG-001 Theme provider replacement.
- `ags-apps` EPIC-002 / REQ-008 spine.

## Evidence

- `ags-apps/_bmad-output/initiative-ags-standalone-apps/architecture-standalone-app-contract/architecture-standalone-app-contract.md`
  (AD-26, AD-27, AD-33, AD-34).
- `contracts` REQ-009 ticket.
