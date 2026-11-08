---
id: BUG-002
title: "Appearance CSS validation mistakes the notifications window ID for a hex colour"
kind: bug
status: done
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

## Implementation

- `ports/appearance.ts`
  - `HEX_COLOR = /#/` is unchanged and is still used only by
    `rejectForbiddenValue` for token/paint values.
  - Added the CSS-only literal matcher:
    `/(?<![\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/`.
    The ordered alternatives plus both token boundaries accept exactly
    3/4/6/8 hex digits; a 5/7-digit run or a longer word does not match.
  - Added `CSS_URL_REFERENCE = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi` and
    removed `url(...)` before the colour scan, so `url(#gradient)` and even a
    hex-shaped SVG fragment are references, not colour atoms.
  - Added `maskCssSelectors`, which blanks selector preludes (the text before
    `{`) before the scan. Hex-shaped IDs are therefore never colour literals,
    while declaration values are still scanned.
  - `validateAppearanceCss` keeps the comment strip, the
    `@define-color <role> <value>;` exemption, and the transition,
    structure/variant and empty-sheet checks. The failure now names the matched
    literal, e.g. `literal hex "#fff" is not allowed; palette roles own colours`.
- `tests/appearance.test.ts` — new regression coverage for selectors,
  `url()` fragments, a leading palette block, all four literal widths and the
  token-value any-`#` rule.
- `tests/fixtures/ags-notifications.css` — copied generated sheet (no host
  paths; 125 `@define-color` lines and `window#notifications-window`).
- `Makefile` — added `gates: test exports typecheck-tests typecheck` so the
  repo has one foreground gate command; no application or runtime code changed.

## Verification

Red before the change (new tests authored first):

```text
$ node --test tests/appearance.test.ts
✖ composed CSS validation accepts ID selectors and url() fragments
✖ composed CSS validation rejects only 3/4/6/8-digit hex colour literals
✖ the generated ags-notifications sheet validates (ID selector regression)
ℹ tests 11  ℹ pass 8  ℹ fail 3   (exit 1)
```

Live repro before the change:

```text
$ node --input-type=module -e "import { readFileSync } from 'node:fs'; import { validateAppearanceCss } from './ports/appearance.ts'; validateAppearanceCss(readFileSync(process.env.HOME + '/.local/state/dotfiles/current/appearance/ags-notifications.css', 'utf8'), 'ags-notifications.css')"
AppearanceParseError: ags-notifications.css: literal hex is not allowed; palette roles own colours  (exit 1)
```

The generated sheet proof: `@define-color` lines = 125, hex atoms = 125, and
the only non-`@define-color` `#` after stripping is
`window#notifications-window`.

Green after the change:

```text
$ node --test tests/appearance.test.ts
ℹ tests 11  ℹ pass 11  ℹ fail 0   (exit 0)

$ node --input-type=module -e "... validateAppearanceCss(readFileSync(process.env.HOME + '/.local/state/dotfiles/current/appearance/ags-notifications.css', 'utf8'), 'ags-notifications.css')"
LIVE PASS   (exit 0)

$ make gates
==> test: node --test tests/
ℹ tests 131  ℹ pass 131  ℹ fail 0
==> exports: node --test tests/exports.test.ts
ℹ tests 2  ℹ pass 2  ℹ fail 0
==> typecheck-tests: tsc -p tests/tsconfig.tests.json
    OK: 0 errors in the pure test suite
==> typecheck: tsc --noEmit -p tsconfig.platform.json
    tolerated third-party errors (/usr/share/ags/js): 7
    OK: 0 errors in the ags-platform tree
make-gates-exit=0
```

Fixture guard: `grep -n '/home/\|/Users/' tests/fixtures/ags-notifications.css`
→ no matches (exit 1), so no host paths or live state are committed.

## Commits

| Commit | Subject |
| --- | --- |
| `29b9016` | `tickets: file BUG-002 appearance CSS hex validation` |
| `7acf206` | `fix(BUG-002): detect CSS hex literals without ID false positives` |
| `8531253` | `chore(BUG-002): add a gates target for the repo gate set` |
| `00d107f` | `docs(BUG-002): document the appearance CSS hex validation patch` |
| this closeout commit | `docs(BUG-002): record appearance CSS hex validation evidence` |

## Status

Complete on `ticket/BUG-002-appearance-css-hex-validation`; worktree
`.worktrees/BUG-002/`, base `ca85672` (main, `v1.0.0`). The closeout commit is
tagged `v1.0.1` and the branch is merged fast-forward to `main`; `main` and the
tag are pushed. This repo publishes no GitHub Releases: the annotated git tag is
the release identity (previous releases `v0.1.0`…`v1.0.0` have no release
objects). No application or runtime repository was modified.
