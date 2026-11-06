---
id: REQ-018
title: "Palette parser accepts theme-producer mode metadata"
kind: requirement
status: done
lane: 3
links:
  openspec: none
  bmad: none
worktree: .worktrees/REQ-018/
branch: ticket/REQ-018-palette-mode-metadata
---

# Palette parser accepts theme-producer mode metadata

## Requirement

`theme-producer` v0.6.0 (REQ-026, commit `486942a`) now emits a quoted
top-level `mode: "dark"` or `mode: "light"` scalar as the first value in every
generated `colors.yaml`. `ags-platform`'s `parsePaletteYaml` treats every
top-level scalar as a palette role and requires hex, so the new artifact fails:

```text
PaletteParseError: colors.yaml:2: role "mode" has invalid value "dark"
```

That failure makes `theme.apply()` degrade to legacy CSS and makes
`theme.palette()` throw for every app on the new producer.

The parser MUST recognize the palette's mode metadata and keep it out of the
role map:

- `mode` is accepted only with the value `dark` or `light`.
- The runtime-recognized aliases are tolerated: `scheme`, `appearance` and
  `variant` as mode strings, then `is_dark` and `dark` as booleans
  (`true` → dark, `false` → light).
- Mode resolution follows the runtime's precedence
  (`mode`, `scheme`, `appearance`, `variant`, then `is_dark`, `dark`;
  `dotfiles-runtime/src/runtime/adapters/appearance.py:77-79,130-160`).
- `Palette.mode?: "dark" | "light"` exposes the resolved metadata when present;
  it is absent when the artifact carries no mode metadata. Existing consumers
  that only read `version`/`roles` keep working.
- Everything else stays strict: unknown top-level keys still fail, role values
  must still be valid palette hex, and the legacy `colors:` list still parses
  as a skipped block.
- Theme provider composition and priority are unchanged; metadata is never
  projected as an `@define-color`.

Evidence: `theme-producer` `v0.6.0` `src/theme_producer/defaults/templates/colors.yaml.j2:3`
emits `mode: "{{ mode_name }}"`; its real-shaped fixture
`tests/fixtures/projections/colors.yaml:2` is `mode: "dark"`. Runtime
precedence is in `dotfiles-runtime/src/runtime/adapters/appearance.py:77-79`
(`_MODE_KEYS` / `_DARK_BOOL_KEYS`) and `:130-160` (`detect_palette_mode`).

Verify before the change (from this worktree, base `aabc5d4`):

```bash
cd /home/inumaki/Development/dotfiles/ags-platform &&
  node --input-type=module -e "import { readFileSync } from 'node:fs'; import { parsePaletteYaml } from './ports/palette.ts'; parsePaletteYaml(readFileSync('/home/inumaki/Development/dotfiles/theme-producer/tests/fixtures/projections/colors.yaml','utf8'), 'colors.yaml')"
```

Observed: `PaletteParseError: colors.yaml:2: role "mode" has invalid value "dark" (expected #rgb, #rrggbb or #rrggbbaa)`, exit 1.

## Acceptance

- [x] `parsePaletteYaml` accepts `mode: "dark"` / `mode: "light"` and the
      aliases `scheme`, `appearance`, `variant`, `is_dark`, `dark` with the
      runtime precedence; metadata never appears in `Palette.roles`.
- [x] `Palette.mode?: "dark" | "light"` is exposed when metadata is present and
      absent otherwise; the type is exported.
- [x] Unknown top-level scalars still raise `PaletteParseError`; role hex
      validation and the legacy `colors:` list are unchanged.
- [x] Tests cover a real-shaped mode-bearing `colors.yaml` (roles + `colors:`),
      mode light, alias tolerance/precedence, unknown scalar failure, role hex
      validation, and theme provider composition.
- [x] README and CHANGELOG document the metadata contract and `v0.9.1`.
- [x] `node --test tests/palette.test.ts tests/theme-provider.test.ts`,
      `make test`, `make exports`, `make typecheck-tests` and local
      `make typecheck` are green.
- [x] Annotated `v0.9.1` tag on the closeout commit; branch merged
      fast-forward to `main`; `main` and the tag pushed.

## Evidence / verify

Run from `.worktrees/REQ-018/`, branch `ticket/REQ-018-palette-mode-metadata`,
base `aabc5d4` (main, `v0.9.0`).

| Claim | Command | Result |
| --- | --- | --- |
| Baseline failure | parser on the theme-producer v0.6.0 fixture | `PaletteParseError: colors.yaml:2: role "mode" has invalid value "dark"`, exit 1 |
| Parser + provider suites | `node --test tests/palette.test.ts tests/theme-provider.test.ts` | `19 pass / 0 fail`, exit 0 |
| Full pure suite | `make test` | `113 pass / 0 fail`, exit 0 |
| Package/export gate | `make exports` | `2 pass / 0 fail`, exit 0 |
| Pure test typecheck | `make typecheck-tests` | `OK: 0 errors in the pure test suite` |
| Local desktop typecheck | `ags types -d "$PWD" -u` then `make typecheck` | `OK: 0 errors in the ags-platform tree`; 7 tolerated `/usr/share/ags/js` errors |
| Exact producer artifact | parser on `theme-producer/tests/fixtures/projections/colors.yaml` (`v0.6.0`) | `{"mode":"dark","version":"1","roles":56,"modeRole":false,"colorsRole":false,"modeDefine":false,"primary":"#26201a","on_backdrop":"#fbd0aa"}` |
| Mode light + aliases + precedence | `node --test tests/palette.test.ts` | dark/light, `scheme`/`appearance`/`variant`, `is_dark`/`dark` and runtime precedence pass; arbitrary alias strings are ignored |
| Strictness preserved | `node --test tests/palette.test.ts` | `mode: "auto"`, `is_dark: maybe`, unknown `backend: "dark"` and invalid role hex still raise `PaletteParseError` with source + line |
| No metadata in CSS | `node --test tests/theme-provider.test.ts` | composed provider keeps the legacy prefix + role defines; no `@define-color mode`; `palette().mode` updates dark → light on refresh |

## Commits

| Commit | Subject |
| --- | --- |
| `1a33353` | `tickets: file REQ-018 palette mode metadata` |
| `cb6bb00` | `fix(REQ-018): accept palette mode metadata` |
| `8d28ad5` | `docs(REQ-018): document palette mode metadata` |
| this closeout commit | `docs(REQ-018): record palette mode metadata evidence` |

## Status

Complete on `ticket/REQ-018-palette-mode-metadata`; worktree
`.worktrees/REQ-018/`, base `aabc5d4` (main, `v0.9.0`). The branch is tagged
`v0.9.1` and merged fast-forward to `main`; `main` and the tag are pushed. No
other repository was modified.
