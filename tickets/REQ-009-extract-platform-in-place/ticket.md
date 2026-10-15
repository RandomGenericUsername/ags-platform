---
id: REQ-009
title: "Extract the platform in-place in dotfiles-v3"
kind: requirement
status: done
lane: 2
links:
  openspec: extract-platform-in-place
  bmad: none
worktree: none
branch: none
---

# Extract the platform in-place in dotfiles-v3

## Requirement

Move the ports + shared adapters + the event client into a `ags-platform` package **inside `dotfiles-v3` first**, wire every app to it, and prove it with the existing gates — before any repo is created. This is the "without deleting code" bridge and the riskiest step.

Source: spine **AD-1**, **AD-19**, **AD-20**; handoff iteration 1, §4.2. Execution: dotfiles-v3 change `extract-platform-in-place` (merged).

## Acceptance

- [x] The package (`dotfiles/config/ags/platform/{ports,adapters}` + `index.ts` + `package.json`) is importable from the bar; no app imports another (the 5 apps' seams untouched — bridge preserved). ✅
- [x] `make bar-typecheck` OK, `make ags-typecheck` PASS, `make ags-test` (132), `make gates-ci` exit 0, `make deploy-coverage` PASS, `ags bundle` exit 0. ✅
- [~] Deploy+eyeball is the `ags-consume-platform` step (distribution); the bundle resolves + the deploy manifest covers the package. ✅ (structural)
