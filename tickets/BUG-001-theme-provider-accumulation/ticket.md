---
id: BUG-001
title: "Theme adapter adds a CSS provider per refresh instead of replacing one"
kind: bug
status: in-progress
lane: 2
severity: medium
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-012/
branch: ticket/REQ-012-ags-app-contract
repro: "rg -n 'paletteProvider|remove_provider|apply_css' adapters/theme.ts /usr/share/ags/js/lib/gtk4/app.ts"
observed: "adapters/theme.ts routes theme.apply() to app.apply_css(path). AGS apply_css creates a new Gtk.CssProvider, adds it to the display and retains it in #cssProviders; no palette provider is removed. The live apps call theme.apply() on every wallpaper done/error, so the provider list grows and the design doc's 'one dedicated provider, replaced in place' contract is false."
expected: "One palette provider per app; each refresh adds the new provider before removing the previous one, leaving the app stylesheet and GTK theme untouched. A test proves the replace sequence and the live refresh path does not accumulate."
---

# Theme adapter adds a CSS provider per refresh instead of replacing one

## Triage

- `kind: bug` — behavior contradicts the documented Theme contract; visual
  output currently appears correct because the newest provider wins.
- `lane: 2` — bounded adapter fix + regression test; no OpenSpec change.
- `severity: medium` — no visual break today, but the provider list grows on
  every palette refresh and the stated contract is false; the cost is unmeasured.
- Evidence: `ags-apps/tickets/SPIKE-001-ags-refresh-patterns/ticket.md`
  §“Extra finding”; current `adapters/theme.ts:24-31`;
  `/usr/share/ags/js/lib/gtk4/app.ts:174-215`; original dedicated provider in
  `dotfiles-v3 512cd5f9`.

## Repro

```bash
rg -n 'paletteProvider|remove_provider|apply_css' adapters/theme.ts /usr/share/ags/js/lib/gtk4/app.ts
```

## Observed

`theme.apply()` → `app.apply_css(path)`. AGS creates and adds a provider and
pushes it into its retained list. There is no palette provider removal path in
the adapter. The three existing live apps call this on every `done`/`error`.

## Expected

One dedicated palette provider per app, added before the previous one is removed;
the app stylesheet remains independently installed. A fake/instrumented sink test
pins add-new → remove-old, and a live refresh path test proves no accumulation.

## Fix notes

- Give the adapter a provider-owning sink (or an explicit `replace` sink) that
  creates the next `Gtk.CssProvider`, adds it, then removes the previous one.
- Keep the base app stylesheet from `app.start({ css: style })` untouched.
- Add a unit test with a fake display sink and a source-level check that no
  palette `app.apply_css` remains.
- The doc update belongs to the consumer docs ticket; do not edit dotfiles-v3 from
  this repo.
