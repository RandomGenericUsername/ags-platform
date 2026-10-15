---
id: REQ-007
title: "Preferences + Notifier + Theme ports"
kind: requirement
status: done
lane: 2
links:
  openspec: preferences-notifier-theme
  bmad: none
worktree: none
branch: none
---

# Preferences + Notifier + Theme ports

## Requirement

Add three platform ports and their adapters:
- **Preferences** — `get(namespace, key, fallback) → Accessor<T>`; the adapter owns the file + monitor lifecycle (fixing the module-scope-monitor GC trap in `recording.tsx`).
- **Notifier** — senders post `NotificationIntent`s; the provider routes transient → freedesktop `Notify`, keyed/progress → the event-card path.
- **Theme** — applies the palette / `colors.gtk.css`; routes the three `theme.ts` copies + direct `apply_css` calls through it.

Source: spine **AD-11**, **AD-12**, **AD-13**; doc 101 §13.7. Execution: dotfiles-v3 change `preferences-notifier-theme` (merged).

## Acceptance

- [x] `bar_compact_controls` read through `Preferences`; the monitor is adapter-owned (no module-scope `FileMonitor`; `grep captureConfigMonitor recording.tsx` → 0). ✅
- [x] No sender constructs a freedesktop `Notify` directly (moved into `lib/notifier.ts`; the bar posts intents). ✅
- [~] The bar themes through the `Theme` port; the 3 app-local `theme.ts` copies are **ags-apps scope**. ✅ (bar scope)
