---
id: REQ-010
title: "Publish ags-platform + CI"
kind: requirement
status: done
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

Source: spine **AD-17**, **AD-23**; Open Question "package boundary + Node type-stripping"; handoff iteration 3. Execution: ags-platform change `publish-ags-platform`.

## Acceptance

- [x] Committed entry point/export map (`package.json` exports `.`/`./ports/*`/`./adapters/*`); AGS's esbuild resolves it by bare specifier (`ags bundle` exit 0). ✅
- [x] CI runs tests + typecheck (`.github/workflows/ci.yml`: `pure` on ubuntu-latest, `desktop-typecheck` self-hosted). ✅
- [x] Test-import decided: relative `.ts` + `node --test` (Node rejects `.ts` under `node_modules`); documented. ✅
