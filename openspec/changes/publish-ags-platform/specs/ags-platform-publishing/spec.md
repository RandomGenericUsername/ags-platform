# ags-platform-publishing (delta)

## ADDED Requirements

### Requirement: The proven package is published byte-faithfully

The ports, the shared adapters, the public entry point and the package identity
proven in-place in `dotfiles-v3` (REQ-009) SHALL be published to this repo's root
byte-faithful, adjusting **only** the paths an import needs. The package SHALL
carry `ports/`, `adapters/`, `index.ts`, `package.json` and the build-time icon
manifest `adapters/icon-registry.ts` imports.

Source: spine **AD-17**, **AD-20**; handoff iteration 3; REQ-009.

#### Scenario: the package matches the in-place source

- **WHEN** the published `ports/`, `index.ts` and `package.json` are diffed
  against `dotfiles-v3:dotfiles/config/ags/platform/`
- **THEN** there is no difference

#### Scenario: only the manifest specifier is adjusted

- **WHEN** the published `adapters/` is diffed against the source
- **THEN** the only difference is `icon-registry.ts`'s manifest specifier
  (`../../icons.json` → `../icons.json`), and the manifest is present at the
  published repo root

### Requirement: The package boundary is a declared export map

The package SHALL declare an `exports` map naming the entry point and the
port/adapter subpaths, so AGS's embedded esbuild resolves the package and its
subpaths by **bare specifier** through a `node_modules` shortcut (AD-17). Every
declared target SHALL resolve to a file in the package.

Source: spine **AD-17**; doc 101 §3.2.

#### Scenario: the boundary declares the entry point and subpaths

- **WHEN** `package.json` is read
- **THEN** it declares `exports` for `.`, `./ports/*` and `./adapters/*`, and
  every declared target resolves to a file

#### Scenario: AGS's embedded esbuild resolves the bare specifier

- **WHEN** a consumer with a `node_modules/ags-platform` shortcut imports
  `ags-platform` or `ags-platform/ports/event-client` and is bundled with
  `ags bundle … --gtk 4`
- **THEN** the bundle exits 0 and inlines the package and the manifest

### Requirement: The package depends on no app; the ports stay pure

The published package SHALL import nothing from an app (AD-1), and the files
under `ports/` SHALL NOT import `gi://*` or `ags`. Host bindings (Gio, Gtk,
gnim, `ags`) SHALL live only under `adapters/`.

Source: spine **AD-1**, **AD-4**; doc 101 §3.1, §4.

#### Scenario: no app import

- **WHEN** the package is searched for imports of a bar/app module
- **THEN** none is present

#### Scenario: the ports stay pure

- **WHEN** the files under `ports/` are searched for `gi://` or `ags` imports
- **THEN** no port imports either

### Requirement: The test-import shape is decided and documented

The package's tests SHALL import the pure ports by **relative path with explicit
`.ts` extensions**, run by `node --test` with native type stripping — not by the
`ags-platform` bare specifier. The decision SHALL be documented, resolving the
spine Open Question "package boundary + Node type-stripping".

Source: spine **AD-17** Open Question; `dotfiles/config/ags/tests/tsconfig.tests.json`
(the in-place pure test project).

#### Scenario: tests run on a stock runner with no desktop stack

- **WHEN** `node --test` (or `make test`) runs
- **THEN** the pure suite passes with no `gi://` or `ags` import and no AGS or
  GTK installed

#### Scenario: the bare specifier is rejected by Node, not by esbuild

- **WHEN** the package physically sits under `node_modules` and Node imports
  `ags-platform/ports/event-client`
- **THEN** Node fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, which
  is why the tests import relatively and AGS's embedded esbuild resolves the
  bare specifier instead

### Requirement: CI runs typecheck + tests per repo

The repo SHALL run the package's typecheck and tests in CI: a **stock runner**
for the pure tests and the pure tests typecheck, and a **self-hosted linux
runner** for the desktop-stack typecheck.

Source: spine **AD-23**; the `bar-typecheck` gate shape in dotfiles-v3.

#### Scenario: the stock runner runs the pure suite

- **WHEN** the stock CI job runs
- **THEN** `make test` and the pure tests typecheck pass with no desktop stack

#### Scenario: the self-hosted runner runs the desktop-stack typecheck

- **WHEN** the self-hosted CI job runs `ags types -d . -u` and `make typecheck`
- **THEN** the typecheck reports 0 errors in this repo's tree (third-party
  `/usr/share/ags/js/` errors are tolerated and counted)

### Requirement: The repo's own governance stays green

`openspec validate` SHALL pass, the `Makefile` targets SHALL run, generated
artifacts (`@girs/`, the `ags types`-generated `tsconfig.json`, `node_modules/`)
SHALL be gitignored, and the working tree SHALL be clean after the
implementation commit.

Source: spine **AD-19** (gate discipline); repo `AGENTS.md` evidence rule.

#### Scenario: the change validates

- **WHEN** `openspec validate publish-ags-platform --type change` runs
- **THEN** it reports valid

#### Scenario: the tree is clean

- **WHEN** `git status --porcelain` runs after the implementation commit
- **THEN** it is empty
