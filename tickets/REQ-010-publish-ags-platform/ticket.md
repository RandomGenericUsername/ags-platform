---
id: REQ-010
title: "Publish ags-platform + CI"
kind: requirement
status: proposed
lane: 2
links:
  openspec: publish-ags-platform
  bmad: none
worktree: none
branch: none
---

# Publish ags-platform + CI

## Requirement

Publish the proven extracted package to this repo with a defined **package boundary** (entry point / export shape) and CI. The package must be consumable by AGS's embedded esbuild via a bare specifier; decide how tests import it (Node rejects `.ts` under `node_modules`).

Source: spine **AD-17**, **AD-23**; Open Question "package boundary + Node type-stripping"; handoff iteration 3.

## Acceptance

- [ ] The package has a committed entry point/export shape; `ags run` resolves it by bare specifier.
- [ ] CI runs typecheck + tests on the platform.
- [ ] The test-import shape is decided and documented (resolves the open question).
