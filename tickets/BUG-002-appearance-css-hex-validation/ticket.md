---
id: BUG-002
title: "Appearance CSS validation mistakes the notifications window ID for a hex colour"
kind: bug
status: in-progress
lane: 2
severity: high
links:
  openspec: none
  bmad: none
worktree: .worktrees/BUG-002/
branch: ticket/BUG-002-appearance-css-hex-validation
repro: "node --input-type=module -e \"import { readFileSync } from 'node:fs'; import { validateAppearanceCss } from './ports/appearance.ts'; validateAppearanceCss(readFileSync(process.env.HOME + '/.local/state/dotfiles/current/appearance/ags-notifications.css', 'utf8'), 'ags-notifications.css')\""
observed: "AppearanceParseError: ags-notifications.css: literal hex is not allowed; palette roles own colours (exit 1), although the sheet has 125 @define-color hex values and its only other # is the window#notifications-window selector."
expected: "validateAppearanceCss accepts the generated ags-notifications.css (exit 0): the # is the ID selector window#notifications-window, not a colour literal. Real literal hex outside @define-color still fails."
---

# Appearance CSS validation mistakes the notifications window ID for a hex colour

## Repro

```bash
cd /home/inumaki/Development/dotfiles/ags-platform &&
node --input-type=module -e "import { readFileSync } from 'node:fs'; import { validateAppearanceCss } from './ports/appearance.ts'; validateAppearanceCss(readFileSync(process.env.HOME + '/.local/state/dotfiles/current/appearance/ags-notifications.css', 'utf8'), 'ags-notifications.css')"
```

## Observed

```text
AppearanceParseError: ags-notifications.css: literal hex is not allowed; palette roles own colours
    at fail (file:///home/inumaki/Development/dotfiles/ags-platform/ports/appearance.ts:132:9)
    at validateAppearanceCss (file:///home/inumaki/Development/dotfiles/ags-platform/ports/appearance.ts:780:5)
exit 1
```

The live v3 appearance refresh for `ags-notifications` fails even though the
generated sheet is valid: 125 hex occurrences are all inside
`@define-color <role> <value>;` lines and the 126th `#` is the selector
`window#notifications-window`.

## Expected

`validateAppearanceCss` accepts the generated `ags-notifications.css` (exit 0)
because `#notifications-window` is an ID selector, not a hex colour. Literal hex
colour atoms outside the `@define-color` block still fail, and the token-value
prohibition still rejects any `#` in a token value.

## Fix notes

Root cause (evidence):

- `ports/appearance.ts:111` defines `const HEX_COLOR = /#/;` for token values.
- `ports/appearance.ts:775-781` strips `@define-color ...;` and then runs
  `HEX_COLOR.test(body)` on the remaining CSS, so any `#` — including a selector
  or `url(#fragment)` — is reported as a colour literal.
- Node proof: after comment + `@define-color` stripping, the only `#` in
  `~/.local/state/dotfiles/current/appearance/ags-notifications.css` is at
  `window#notifications-window`; the sheet has 125 `@define-color` lines and
  125 hex atoms.

Fix: keep `HEX_COLOR = /#/` for token values, but use a separate precise
CSS-only regex for `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` with boundaries,
and ignore `url(...)` references. Preserve the `@define-color` exemption and
the transition, structure/variant and empty-sheet checks. Add regression tests
plus a host-path-free fixture copied from the generated notifications sheet.
