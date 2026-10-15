# Tasks

## 1. Plan (commit 1)

- [ ] 1.1 Author the change: `proposal.md`, this `tasks.md`, and
  `specs/ags-platform-publishing/spec.md` with ADDED Requirements + Scenarios
  citing AD-1, AD-17, AD-23 and the "package boundary + Node type-stripping"
  Open Question.
  Verify: `openspec validate publish-ags-platform --type change` → valid.

## 2. Publish the proven package (AD-17, AD-20)

- [ ] 2.1 Import `ports/`, `adapters/`, `index.ts`, `package.json` from
  `dotfiles-v3:dotfiles/config/ags/platform/` to the repo root, byte-faithful.
  Verify: `diff -r "$SRC/ports" ports` and `diff "$SRC/index.ts" index.ts` →
  no output; `diff "$SRC/package.json" package.json` → no output.
- [ ] 2.2 Adjust the one path the import needs: `adapters/icon-registry.ts`
  `../../icons.json` → `../icons.json`, and import the manifest to the repo root.
  Verify: `diff -r "$SRC/adapters" adapters` → the **only** difference is line 2
  of `icon-registry.ts`; `diff "$SRC/../icons.json" icons.json` → no output.

## 3. Define the package boundary (AD-17)

- [ ] 3.1 Confirm the `exports` map (entry point + `./ports/*` + `./adapters/*`)
  and add `tests/exports.test.ts` asserting the map and that every declared
  target resolves to a file.
  Verify: `node --test tests/exports.test.ts` → `pass`, `fail 0`.
- [ ] 3.2 Prove the bare specifier resolves through a `node_modules` shortcut
  with AGS's embedded esbuild.
  Verify: `ags bundle` of a two-line consumer that imports `ags-platform` and
  `ags-platform/ports/event-client` → exit 0.

## 4. Decide the test-import shape (Open Question)

- [ ] 4.1 Add the pure test suite under `tests/`, importing the ports by
  **relative `.ts` path** (`../ports/*.ts`) with a fake reactive runtime; run it
  with `node --test` (native type stripping).
  Verify: `make test` (or `node --test`) → `tests 11, pass 11, fail 0`.
- [ ] 4.2 Document the decision in `proposal.md` §3 and confirm Node's rejection
  of the bare `.ts` specifier under `node_modules` is the reason.
  Verify: `node -e 'import("ags-platform/ports/event-client")'` with the package
  under `node_modules` → `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.

## 5. Typecheck configs

- [ ] 5.1 Add `tsconfig.platform.json` (desktop-stack: `strict`,
  `moduleResolution: Bundler`, `resolveJsonModule`, `allowImportingTsExtensions`,
  `types: []`, includes `@girs/index.d.ts`).
  Verify: `tsc -p tsconfig.platform.json` → 0 errors in the repo tree.
- [ ] 5.2 Add `tests/tsconfig.tests.json` (pure: `types: ["node"]`, no `gi://`,
  no `ags`) so the tests typecheck on a stock runner.
  Verify: `make typecheck-tests` → exit 0.

## 6. CI (AD-23)

- [ ] 6.1 Add `.github/workflows/ci.yml` with a stock `pure` job
  (`make test`, `make typecheck-tests`) and a `[self-hosted, linux]`
  `desktop-typecheck` job (`ags types -d . -u` then `make typecheck`).
  Verify: the workflow parses as YAML and names both jobs.
- [ ] 6.2 `make typecheck` follows the `bar-typecheck` gate shape: fail only on
  errors in this repo's tree; tolerate `/usr/share/ags/js/` third-party errors.
  Verify: `make typecheck` on a machine with the desktop stack → `OK: 0 errors`
  and a tolerated third-party count.

## 7. Keep governance green

- [ ] 7.1 `openspec validate publish-ags-platform --type change` → valid.
- [ ] 7.2 `.gitignore` covers `@girs/`, the `ags types`-generated `tsconfig.json`,
  and `node_modules/`; `git status --porcelain` is clean after the
  implementation commit.
  Verify: `git status --porcelain` → empty.
