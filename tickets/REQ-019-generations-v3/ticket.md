---
id: REQ-019
title: "Generations v3 state-only appearance consumer and generation-bound refresh"
kind: requirement
status: done
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-019/
branch: ticket/REQ-019-generations-v3
---

# Generations v3 state-only appearance consumer and generation-bound refresh

## Requirement

Contracts `v0.8.0` freezes Generations v3: one immutable
`state/generations/<genHash>/` directory, one atomic `state/current` pointer,
and a generation-bound `["appearance-refresh", "<genHash>"]` request whose
response MUST name the same `genHash`. `ags-platform` is wave 2 of the
migration: it must consume that plane instead of the v2 multi-pointer and the
`{"ok":true}` ack.

The platform MUST:

- Read only from the state plane:
  `$XDG_STATE_HOME/dotfiles/current/manifest.json`,
  `current/appearance/<configDir>.css` and
  `current/appearance/tokens.json`. It MUST NOT read
  `$XDG_CONFIG_HOME/<configDir>/appearance.css`, a v1/v2 skin path, an app tag
  or an install-spine convenience link.
- Watch exactly ONE hop, `$XDG_STATE_HOME/dotfiles/current`, with a
  `Gio.FileMonitor` (`WATCH_MOVES`) and a 50 ms debounce. Monitor/provider
  references stay module-scoped. There is no polling and one provider/monitor
  per app instance.
- Expose `applyGeneration(genHash)` and `apply(genHash?)` on
  `createAppearance({ configDir })`, plus `appliedHash()`. Resolution is
  immutable: prefer `generations/<genHash>/...`; if it falls back to reading
  through `current`, verify `manifest.generationHash` before AND after the
  read and answer deferred on a mismatch. A requested generation that is not
  the committed one, or is absent, is never applied.
- Install the exact composed sheet as ONE provider at
  `GTK_STYLE_PROVIDER_PRIORITY_USER` = 800, add-before-remove, exactly once
  per generation.
- Implement the v3 refresh handler
  `["appearance-refresh", "<genHash>"]` returning exactly
  `{"applied":"<genHash>"}`, `{"deferred":"reason","genHash":"<genHash>"}` or
  `{"failed":"reason","retryable":true|false,"genHash":"<genHash>"}`. A
  pointer move or missing generation yields deferred/retryable with the
  requested hash; `{"ok":true}` is never produced or accepted by the new
  handler.
- Keep the v2 `createPaletteRefreshHandler` helper exported and marked
  deprecated while apps migrate; it is not used by the new handler.
- Not modify `dotfiles-runtime` or any app repository.

## Acceptance

- [x] State-only reads and one watched hop `current`; no
      `$XDG_CONFIG_HOME/*/appearance.css` or v1/v2 skin read path.
- [x] Manifest verification (`version: 3`, lowercase 64-hex
      `generationHash`, `appearance.tokensPath`, `appearance.targets`) and
      target/path resolution fail closed.
- [x] `applyGeneration(genHash)` / `apply(genHash?)` / `appliedHash()` exist;
      direct `generations/<genHash>/...` is preferred and a `current` fallback
      verifies the manifest before and after reading.
- [x] Stale pointer or absent generation returns deferred/retryable with the
      requested hash; a hash mismatch is never applied.
- [x] Exactly one provider apply per generation, at USER priority 800,
      add-before-remove.
- [x] v3 `appearance-refresh` handler returns only the frozen response union;
      malformed requests and old `{"ok":true}` are invalid; async and app-owned
      work remain supported with one response.
- [x] Tests cover manifest verification, generation-path apply, stale pointer,
      hash mismatch, exactly-one-apply, watch `current` only, v3 token path,
      provider priority/last, missing-generation fallback, no config-link read,
      and the v3 handler ack/deferred/failed cases.
- [x] README and CHANGELOG document Generations v3 and `v1.0.0`.
- [x] `node --test` (new + existing), `make test`, `make exports`,
      `make typecheck-tests` and local `make typecheck` are green.
- [x] Annotated `v1.0.0` tag on the closeout commit; branch merged
      fast-forward to `main`; `main` and the tag pushed.

## Evidence / verify

Run from `.worktrees/REQ-019/`, branch
`ticket/REQ-019-generations-v3`, base `d509c2f` (main, `v0.9.1`).

| Claim | Command | Result |
| --- | --- | --- |
| New + existing appearance suites | `node --test tests/appearance-v3.test.ts tests/appearance.test.ts` | `28 pass / 0 fail`, exit 0 |
| Full pure suite | `make test` | `128 pass / 0 fail`, exit 0 |
| Package/export gate | `make exports` | `2 pass / 0 fail`, exit 0 |
| Pure test typecheck | `make typecheck-tests` | `OK: 0 errors in the pure test suite` |
| Local desktop typecheck | `make typecheck` | `OK: 0 errors in the ags-platform tree`; 7 tolerated `/usr/share/ags/js` errors |
| No config-home read in the consumer | `grep -n "get_user_config_dir" adapters/appearance.ts adapters/appearance-scope.ts` | no matches (exit 1) |
| State path only | `grep -n "stateHome}/dotfiles\|generationsPath\|manifestPath" ports/appearance.ts` | `resolveAppearancePaths` returns `current`, `manifest.json`, `generations/`, `appearance/tokens.json` |
| One monitor on `current` | `rg "monitor_file|APPEARANCE_WATCH_POINTER|RELOAD_DEBOUNCE_MS" adapters/appearance.ts` | one `monitor_file(...WATCH_MOVES...)`; `APPEARANCE_WATCH_POINTER = "dotfiles/current"`; `RELOAD_DEBOUNCE_MS = 50`; module-scoped sets |
| Direct generation is preferred | `node --test tests/appearance-v3.test.ts` | `applyGeneration prefers generations/<genHash>/... over current` passes; direct CSS observed |
| Stale pointer/hash mismatch never applies | `node --test tests/appearance-v3.test.ts` | stale pointer → deferred with requested hash; mismatched generation manifest → failed; zero provider ops |
| v3 handler never emits an ok ack | `node --test tests/appearance-v3.test.ts` | `{applied:<hash>}` only; malformed/v2/`{ok:true}` work results rejected |
| Scope stayed inside `ags-platform` | `git diff --stat d509c2f..HEAD` | only `ags-platform` files; no runtime/app repo modified |

## Commits

| Commit | Subject |
| --- | --- |
| `de1b98d` | `tickets: file REQ-019 generations v3` |
| `1ab6bcf` | `feat(REQ-019): consume generations v3 state plane` |
| `6ce3b2b` | `docs(REQ-019): document generations v3 and v1.0.0` |
| this closeout commit | `docs(REQ-019): record generations v3 evidence` |

## Status

Complete on `ticket/REQ-019-generations-v3`; worktree
`.worktrees/REQ-019/`, base `d509c2f` (main, `v0.9.1`). The closeout commit is
tagged `v1.0.0` and the branch is merged fast-forward to `main`; `main` and the
tag are pushed. No other repository was modified.
