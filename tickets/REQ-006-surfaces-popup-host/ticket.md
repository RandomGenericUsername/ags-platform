---
id: REQ-006
title: "Surfaces + PopupHost"
kind: requirement
status: proposed
lane: 2
links:
  openspec: surfaces-popup-host
  bmad: none
worktree: none
branch: none
---

# Surfaces + PopupHost

## Requirement

Formalise `SurfaceSpec`/`SurfaceRegistry` (bodies are **factories**, mounted only while visible) and ship `PopupHost` (window + click-catcher + anchor margin + keymode), absorbing **all five** current popups — AudioPopup, WifiPopup, BatteryPopup, **BluetoothPopup**, SettingsPanel — and deleting the duplicated chrome.

Source: spine **AD-10**; doc 101 §13.5; sweep evidence (5 popups, not 4).

## Acceptance

- [ ] `SurfaceSpec.body` is a factory; at most one overlay is live (test).
- [ ] The five popups use `PopupHost`; the duplicated catcher/margin/keymode code is gone (grep).
- [ ] `WifiContent`/`BluetoothContent` still mount in both the popup and the settings panel.
