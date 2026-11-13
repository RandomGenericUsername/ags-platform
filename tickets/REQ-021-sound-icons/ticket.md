---
id: REQ-021
title: "Regenerate the icon registry manifest for sound controls"
kind: requirement
status: done
lane: 1
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-021/
branch: ticket/REQ-021-sound-icons
---

# Icon registry manifest

Regenerate the build-time `icons.json` from the pinned assets corpus
(v0.21.0): the new `media-controls` group and
`settings-panel.settings` gear, with current semantic role mappings. The bar
app tag copies this platform artifact byte-for-byte; provisioning verifies the
single producer.

## Acceptance

- [x] `icons.json` has 23 groups including `media-controls` and the
      `settings-panel.settings` variant.
- [x] Platform gates (test/exports/typecheck) pass.
- [x] Tag `v1.2.0`.

## Live

Platform `v1.2.0` is installed; the bar's `icons.json` is byte-identical, and
the sound panel resolves the new groups. Bootstrap verify `ok=337 failed=0`.

## Final

Platform v1.2.0 canonicalized to `main`; the final live install and bar
`icons.json` byte-match; the assets v0.21.1 shuffle opacity is an asset
template change, not a registry mapping change.
