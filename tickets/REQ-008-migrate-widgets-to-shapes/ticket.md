---
id: REQ-008
title: "Migrate the bar widgets onto the shapes"
kind: requirement
status: proposed
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

Source: spine **AD-8**, **AD-9**; doc 101 §13.6; sweep evidence (only 4 live descriptors; 7 hand-rolled).

## Acceptance

- [ ] Every bar widget is one of the four shapes; `Bar.tsx` renders via the layout provider.
- [ ] `network-descriptor.tsx` is wired and `network.tsx` is retired (or the choice recorded).
- [ ] `make bar-typecheck` + `make ags-test` pass.
