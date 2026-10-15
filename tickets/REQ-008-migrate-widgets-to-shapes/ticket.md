---
id: REQ-008
title: "Migrate the bar widgets onto the shapes"
kind: requirement
status: done
lane: 2
links:
  openspec: migrate-widgets-to-shapes
  bmad: none
worktree: none
branch: none
---

# Migrate the bar widgets onto the shapes

## Requirement

Move the hand-rolled widgets onto the frozen shapes: clock + recording → `RichWidgetSpec`, workspaces → `CollectionSpec`, tray → `ForeignCollectionSpec`, and network/battery/bluetooth/audio → `DescriptorSpec` (including wiring the currently-dead `network-descriptor.tsx` and retiring `network.tsx`). Bar composition becomes the repo-default `LayoutProvider`.

Source: spine **AD-8**, **AD-9**; doc 101 §13.6; sweep evidence (only 4 live descriptors; 7 hand-rolled). Execution: dotfiles-v3 change `migrate-widgets-to-shapes` (merged). Deviations: audio-mic = RichWidgetSpec (live-dot badge); `spacing?` on collections; recording = its own entry.

## Acceptance

- [x] Every bar widget is one of the four shapes; `Bar.tsx` renders via the repo-default `LayoutProvider` (`kit/layout.ts` + `bar/layout.default.ts` + `bar/registry.ts`). ✅
- [x] `network-descriptor.tsx` wired; `network.tsx` retired (deleted; manifest entry removed). ✅
- [x] `make bar-typecheck` OK + `make ags-test` (132) pass; `gates-ci` exit 0; `deploy-coverage` PASS. ✅
