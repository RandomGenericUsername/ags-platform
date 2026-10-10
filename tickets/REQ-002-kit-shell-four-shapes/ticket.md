---
id: REQ-002
title: "Kit completeness + Shell + four widget shapes"
kind: requirement
status: proposed
lane: 2
links:
  openspec: kit-shell-four-shapes
  bmad: none
worktree: none
branch: none
---

# Kit completeness + Shell + four widget shapes

## Requirement

Add `IconRef.fallback?` and the rich `content` field, then freeze the widget vocabulary as one `Shell<S>` shared by `DescriptorSpec`, `RichWidgetSpec`, `CollectionSpec`, and `ForeignCollectionSpec` (`DescriptorSpec` realized from today's `BarWidgetSpec`). Anchoring/gestures/tooltip/visible/class/stateClass live only in the `Shell`.

Source: spine **AD-4** (fallback), **AD-7**, **AD-8**; doc 101 §5, §13.1.

## Acceptance

- [ ] `IconRef` carries `fallback?` and the resolution chain uses it (unit test).
- [ ] `Shell<S>` + the four shapes are exported; `DescriptorSpec` covers the current descriptor widgets.
- [ ] `popup(...)`/`hub.control(...)` are `BarContext` capabilities, not shapes.
