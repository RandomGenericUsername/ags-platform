---
id: REQ-012
title: "AGS app manifest helper, palette-refresh handler helper and template conformance"
kind: requirement
status: done
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-012/
branch: ticket/REQ-012-ags-app-contract
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

- [x] Manifest types match the contracts schema and are exported from the package.
- [x] The handler helper returns one JSON string, exactly once, on every path
      (success, deferred, busy, error), and rejects object responses.
- [x] The helper preserves the app's state contract; it does not restart or
      mutate app state itself.
- [x] The template-conformance helper checks the required repo files, manifest
      identity/shape, handler for live mode and ticket flow.
- [x] Unit tests cover success/deferred/busy/error and template pass/fail.
- [x] The package exports and CI gates are updated; no app-specific policy enters
      the platform.
- [x] The Theme one-provider fix (BUG-001) is a dependency for any live refresh
      use.

## Dependencies

- `contracts` REQ-009 schemas/protocol.
- `ags-platform` BUG-001 Theme provider replacement.
- `ags-apps` EPIC-002 / REQ-008 spine.

## Evidence

- `ags-apps/_bmad-output/initiative-ags-standalone-apps/architecture-standalone-app-contract/architecture-standalone-app-contract.md`
  (AD-26, AD-27, AD-33, AD-34).
- `contracts` REQ-009 ticket at `5eb01b8`: `schemas/ags-app-manifest.schema.json`,
  `schemas/ags-app-refresh-result.schema.json`, `ags-app-refresh.md`.
- AGS 3.1.0 string transport: `/usr/share/ags/js/lib/gtk4/app.ts:272-296`.

### What changed

- `ports/app-manifest.ts` — the manifest union (`AgsAppManifestLive` /
  `AgsAppManifestRestart` / `AgsAppManifest`), schema constants and
  `validateAgsAppManifest`/`parseAgsAppManifest`. It mirrors
  `additionalProperties: false`, `schemaVersion: 1`, the one-lowercase-path-segment
  identity pattern and the restart/`holdsUnsavedState` rule.
- `ports/palette-refresh.ts` — `createPaletteRefreshHandler(refresh)`. It validates
  the fixed `["palette-refresh", "<appearance-hash>"]` argv, calls the app refresh
  once, and writes exactly one JSON-encoded string on every path. Concurrent
  requests get `busy`; throws/rejections are retryable failures; malformed argv and
  invalid result objects are terminal failures. It never schedules follow-up work
  after `ok:true` and never mutates app state itself.
- `ports/app-conformance.ts` — the pure template gate; `conformance/app-conformance.ts`
  binds it to Node `fs`; `conformance/check.ts` is the invocable CLI. It checks the
  required template files, CI/tests/ticket templates, manifest shape/identity
  fields, a live handler in app source and the ticket INDEX rollup. Deployed
  identity equality remains runtime-owned.
- `index.ts`/`package.json` export the manifest, handler and pure conformance
  surface; `./conformance/*` is a separate subpath so the GJS runtime never pulls
  in `node:fs`.
- `README.md`, `Makefile` (`make exports`), and CI (the package/export gate) are
  updated. The existing BUG-001 Theme replacement and `ports/theme.ts` are
  untouched; the theme tests still pass.

### Verification

Commands run from `.worktrees/REQ-012/`, branch
`ticket/REQ-012-ags-app-contract`, base `57c38c5`.

| Claim | Command | Result |
| --- | --- | --- |
| Manifest shape, identity, restart rule | `make test` (`tests/app-manifest.test.ts`) | 7 tests pass; unknown fields, wrong `schemaVersion`, non-segment identity values, restart+unsaved all rejected |
| One JSON string on applied/deferred/busy/error, no object pass-through | `make test` (`tests/palette-refresh.test.ts`) | 9 tests pass; applied/deferred/busy/retryable/terminal/throw/rejection/malformed/object-result all covered |
| Template pass/fail and ticket flow | `make test` (`tests/app-conformance.test.ts`) | 7 tests pass; live pass, restart pass, missing files/CI/tests/template, bad manifest, missing handler, unlisted/missing tickets, Node adapter+CLI all covered |
| Full pure suite | `make test` | `48 pass / 0 fail`, exit 0 |
| Pure test typecheck | `make typecheck-tests` | `OK: 0 errors in the pure test suite`, exit 0 |
| Package/export gate | `make exports` | `2 pass / 0 fail`, exit 0 |
| Local desktop typecheck | `make typecheck` | `OK: 0 errors in the ags-platform tree`; 7 tolerated `/usr/share/ags/js` errors |
| Red before implementation | `make test` with the three new test files only | `3 failed` (`ERR_MODULE_NOT_FOUND` for `ports/app-manifest.ts`, `ports/palette-refresh.ts`, `ports/app-conformance.ts`), `25 pass` |
| Red proof that the busy test catches a missing guard | temporarily changed `if (inFlight)` to `if (false)` in `ports/palette-refresh.ts`, then `node --test tests/palette-refresh.test.ts` | fails `busy must not start a second refresh` (`2 !== 1`); restored byte-for-byte, green |
| Red proof that the template test catches a missing required-file check | temporarily disabled the required-file check in `ports/app-conformance.ts`, then `node --test tests/app-conformance.test.ts` | fails the missing-file assertion (`true !== false`); restored byte-for-byte, green |
| BUG-001 preserved | `make test` | the three `tests/theme-provider.test.ts` cases still pass |
| Worktree clean at closeout | `git status --porcelain` | empty after the closeout commit |

### Commits

| Commit | Subject |
| --- | --- |
| `f87fad3` | `chore(REQ-012): start — record worktree/branch, move to in-progress` |
| `caa375b` | `feat(REQ-012): add the app manifest, palette-refresh and conformance helpers` |
| closeout commit | `docs(REQ-012): record evidence, tick acceptance, close the ticket` |

### Status

**Closed — done on `ticket/REQ-012-ags-app-contract`.** The manifest types,
`palette-refresh` handler helper and template-conformance gate/CLI are exported and
tested; BUG-001's one-provider Theme behavior is unchanged. No contract field was
ambiguous: the only non-repo-local identity equality is explicitly documented as
runtime-owned. The branch is neither merged nor pushed.
