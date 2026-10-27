---
id: BUG-001
title: "Theme adapter adds a CSS provider per refresh instead of replacing one"
kind: bug
status: done
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

## Implementation

- `ports/theme.ts` — added `CssProviderHandle`, `CssProviderHost` and
  `createReplacingCssSink(host)`. The sink keeps one handle: it calls
  `host.add(next)` and only then `host.remove(previous)`. A failed add leaves the
  previous provider current, so the sink never loses track of what it installed.
  `Theme` and `CssSink` are unchanged (the public port is preserved).
- `adapters/theme.ts` — binds the host to `Gtk.CssProvider` +
  `Gtk.StyleContext` at `STYLE_PROVIDER_PRIORITY_USER` and keeps the stable
  `colors.css` pointer. It no longer imports or calls the AGS app CSS helper, so
  the app stylesheet installed at app start and the GTK theme are untouched.
- `index.ts` — exports `createReplacingCssSink` and the two host types alongside
  the existing `createTheme` / `CssSink` / `Theme` exports.
- `tests/theme-provider.test.ts` — a fake display records add/remove operations
  and the installed set. The test applies the palette five times and asserts
  `add:next → remove:previous` each time, exactly one provider installed after
  every refresh, and a peak of two only while the new provider is added before
  the old is removed. A source-level test pins the adapter to no `apply_css`,
  no `reset_css`, no `ags/gtk4/app` import, and one add/remove pair.

## Verification

Red (test authored before the fix):

```text
$ node --test tests/theme-provider.test.ts
SyntaxError: The requested module '../ports/theme.ts' does not provide an export named 'createReplacingCssSink'
✖ tests/theme-provider.test.ts
ℹ tests 1  ℹ pass 0  ℹ fail 1
```

The repro also showed the old path before the change:
`adapters/theme.ts:26: app.apply_css(path)`.

Green:

```text
$ make test
ℹ tests 25  ℹ pass 25  ℹ fail 0

$ make typecheck-tests
OK: 0 errors in the pure test suite

$ make typecheck   # after `ags types -d "$PWD" -u`
tolerated third-party errors (/usr/share/ags/js): 7
OK: 0 errors in the ags-platform tree
```

Repro after the fix:

```text
$ rg -n 'apply_css|paletteProvider|import app from' adapters/theme.ts
(no matches, exit 1)

$ rg -n 'paletteProvider|remove_provider|apply_css' adapters/theme.ts /usr/share/ags/js/lib/gtk4/app.ts
/usr/share/ags/js/lib/gtk4/app.ts:... (the AGS helper itself)
adapters/theme.ts:59: Gtk.StyleContext.remove_provider_for_display(
```

The only palette provider operation in the adapter is now its own
`remove_provider_for_display` for the handle it added.

## Manual boundary

The fake-display test proves the sink's call order and provider count at the
seam `ports/theme.ts` owns; it does not execute GTK. The real
`Gtk.StyleContext` binding is covered by the local `make typecheck` (types) and
remains manually verified for live visual behavior: run a live app through two
palette refreshes and confirm the display keeps one palette provider. No GUI was
driven in this fix. The consumer refresh call sites (`theme.apply()`) are in
`ags-apps` and need no change because `Theme`/`CssSink` did not change.
