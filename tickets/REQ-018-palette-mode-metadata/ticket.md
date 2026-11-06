---
id: REQ-018
title: "Palette parser accepts theme-producer mode metadata"
kind: requirement
status: in-progress
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

- [ ] `parsePaletteYaml` accepts `mode: "dark"` / `mode: "light"` and the
      aliases `scheme`, `appearance`, `variant`, `is_dark`, `dark` with the
      runtime precedence; metadata never appears in `Palette.roles`.
- [ ] `Palette.mode?: "dark" | "light"` is exposed when metadata is present and
      absent otherwise; the type is exported.
- [ ] Unknown top-level scalars still raise `PaletteParseError`; role hex
      validation and the legacy `colors:` list are unchanged.
- [ ] Tests cover a real-shaped mode-bearing `colors.yaml` (roles + `colors:`),
      mode light, alias tolerance/precedence, unknown scalar failure, role hex
      validation, and theme provider composition.
- [ ] README and CHANGELOG document the metadata contract and `v0.9.1`.
- [ ] `node --test tests/palette.test.ts tests/theme-provider.test.ts`,
      `make test`, `make exports`, `make typecheck-tests` and local
      `make typecheck` are green.
- [ ] Annotated `v0.9.1` tag on the closeout commit; branch merged
      fast-forward to `main`; `main` and the tag pushed.

## Evidence / verify

Run from `.worktrees/REQ-018/`, branch `ticket/REQ-018-palette-mode-metadata`,
base `aabc5d4` (main, `v0.9.0`).

| Claim | Command | Result |
| --- | --- | --- |
| Baseline failure | parser on the theme-producer v0.6.0 fixture | `PaletteParseError: colors.yaml:2: role "mode" has invalid value "dark"`, exit 1 |
| Parser + provider suites | `node --test tests/palette.test.ts tests/theme-provider.test.ts` | pending |
| Full pure suite | `make test` | pending |
| Package/export gate | `make exports` | pending |
| Pure test typecheck | `make typecheck-tests` | pending |
| Local desktop typecheck | `make typecheck` | pending |
| Exact producer artifact | parser on `theme-producer/tests/fixtures/projections/colors.yaml` | pending |

## Status

In progress on `ticket/REQ-018-palette-mode-metadata`; worktree
`.worktrees/REQ-018/`, base `aabc5d4` (main, `v0.9.0`).
