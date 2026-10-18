---
id: REQ-011
title: "Overlay lifecycle primitive (present-first, defer-heavy, skip-when-unchanged)"
kind: requirement
status: in-progress
lane: 2
links:
  openspec: none
  bmad: none
worktree: .worktrees/overlayload/
branch: ticket/overlayload-lifecycle
---

# Overlay lifecycle primitive (present-first, defer-heavy, skip-when-unchanged)

## Requirement

Make the overlay-load performance pattern proven in `ags-apps` (`725ffdf`,
hypr-pano `ui/PanoWindow.tsx`) a REUSABLE PLATFORM PRIMITIVE, so every overlay
surface adopts it as code rather than copy-paste. The primitive MUST express, in
one place:

1. `present()` FIRST — the surface is on screen before any heavy work;
2. a cheap synchronous `hydrate()` (read + visibility + highlight);
3. the heavy `build()` DEFERRED to the host idle queue;
4. `build()` SKIPPED when the content signature is unchanged;
5. a RE-CHECK inside the idle callback, so a state change (or an unmap) between
   `map` and the callback is honoured.

It MUST split per the platform discipline: a PURE part (no `ags`, no `gi://*`)
holding the ordering + skip/defer decision and the signature function, and an
ADAPTER part binding `GLib.idle_add` (injectable, so the pure part stays
testable). It MUST be exported from `index.ts` without breaking existing exports.

Source: `ags-apps` commit `725ffdf` (measured `map -> first frame` 447-504 ms ->
5.5 ms cold / ~1 ms warm); platform discipline AD-2/AD-4; notifier/theme/
preferences pure-core + injected-seam idiom.

## Acceptance

- [x] Pure core in `ports/overlay-lifecycle.ts` with no `ags`/`gi://*` import.
      Evidence: `grep -n 'gi://\|from "ags' ports/overlay-lifecycle.ts` returns
      only doc-comment mentions, no import.
- [x] `GLib.idle_add` bound in `adapters/overlay-lifecycle.ts` as an injectable
      `OverlayScheduler`. Evidence: `make typecheck` -> 0 errors in the tree.
- [x] Exported from `index.ts` per the explicit-export convention, existing
      exports intact. Evidence: `make typecheck-tests` + `make test` green.
- [x] Unit tests cover unchanged -> no rebuild, changed -> rebuild, the idle
      re-check (changed and already-rebuilt), unmap cancellation, and the
      adapter ordering with a stubbed scheduler.
      Evidence: `make test` -> 22 pass / 0 fail (11 new).
- [x] No app-specific policy and no dotfiles paths in the primitive.

## Gaps (honest)

- No OpenSpec change authored (`links.openspec: none`): planning artifacts are
  the orchestrator's call; this ticket records the worktree/branch only.
- `refresh()` (live content change while mapped) is synchronous, matching the
  reference; it is not exercised in production by this repo (no AGS app runs
  here) — only by the unit tests.
