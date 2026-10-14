---
id: REQ-002
title: "Kit completeness + Shell + four widget shapes"
kind: requirement
status: done
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

Source: spine **AD-4** (fallback), **AD-7**, **AD-8**; doc 101 §5, §13.1. Execution: dotfiles-v3 change `kit-shell-four-shapes` (merged at `4f40809a`).

## Acceptance

- [x] `IconRef` carries `fallback?` and the resolution chain (`provider table → ref.fallback → blank`) uses it (`kit-icon-source.test.ts`, 6 tests). ✅
- [x] `Shell<S>` + the four shapes are exported (`kit/shapes.ts`); `DescriptorSpec` realizes `BarWidgetSpec`, so the four live descriptors typecheck unchanged. ✅
- [x] `popup(...)`/`hub.control(...)` are `BarContext` capabilities, not shapes. ✅
- [x] Gates green: `make ags-test` (75), `make ags-typecheck` PASS, `make bar-typecheck` OK, `make gates-ci` exit 0. ✅
