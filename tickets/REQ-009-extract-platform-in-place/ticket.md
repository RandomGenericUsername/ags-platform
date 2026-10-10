---
id: REQ-009
title: "Extract the platform in-place in dotfiles-v3"
kind: requirement
status: proposed
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

Source: spine **AD-1**, **AD-19**, **AD-20**; handoff iteration 1, §4.2.

## Acceptance

- [ ] The package is importable from the bar and every app; no app imports another.
- [ ] `make bar-typecheck`, `make ags-typecheck`, `make ags-test`, `make gates-ci` all pass.
- [ ] The bar runs on the host with the extracted package (deploy + eyeball).
