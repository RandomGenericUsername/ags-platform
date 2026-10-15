# publish-ags-platform

## Why

REQ-009 extracted the platform **in-place in `dotfiles-v3`** and proved it with the
existing gates (spine **AD-20**: extract in-place first, prove, *then* publish).
This change is the publish step — **iteration 3** of the handoff
(`docs/HANDOFF-ags-platform.md` §5) and **REQ-010**.

The governing invariants:

- **AD-17 — one unit, shared ancestor.** The framework is installed **as one
  versioned unit** at a shared ancestor on every app's resolution path and found
  by a **bare specifier** via a `node_modules` shortcut, **resolved by AGS's
  embedded esbuild, not Node**. The **package boundary (entry point / export
  shape) is new work** — see Open Questions. This change defines that boundary.
- **AD-1 — one-way dependency.** `contracts ← ags-platform ← ags-apps`; the
  platform depends on no app. `ports/` stay pure (no `gi://`, no `ags`).
- **AD-23 — operational envelope.** CI **per repo**: `ags-platform` runs
  **typecheck + tests**; a **stock runner for pure gates** and a **self-hosted
  linux runner for desktop-stack typechecks**.
- **Open Question — "package boundary + Node type-stripping."** AD-17 assumes a
  `node_modules` bare specifier, but Node v26 rejects `.ts` under `node_modules`
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) while the test setup uses
  `node --test` with native type stripping. **Decide how the package's tests
  import it.** This change resolves that open question.

The proven package is `dotfiles-v3:dotfiles/config/ags/platform/`: `ports/`
(event-client, icon-source, notifier, preferences, reactive, theme), `adapters/`
(astal, event-bus, icon, icon-registry, notifier, preferences, theme),
`index.ts`, and `package.json` (name `ags-platform`, an `exports` map).

Evidence:

- `find dotfiles-v3:dotfiles/config/ags/platform -type f` → 15 files
  (`ports/*` ×6, `adapters/*` ×7, `index.ts`, `package.json`).
- Prototype import to a scratch repo root, byte-faithful except the one
  manifest path the import needs:
  `diff -r <src>/adapters <dst>/adapters` → the **only** line is
  `import iconsData from "../../icons.json"` → `"../icons.json"` (the manifest
  is a sibling of the package root in dotfiles; at the published repo root it is
  one level shallower). `diff` of `ports/`, `index.ts`, `package.json`,
  `icons.json` → identical.
- **Node rejects the bare specifier** when the package physically sits under
  `node_modules`:
  `node -e 'import("ags-platform/ports/event-client")'` →
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING: Stripping types is currently
  unsupported for files under node_modules`.
- **AGS's embedded esbuild resolves it** via the shortcut:
  `ags bundle consumer/app.ts out.js --gtk 4` (with
  `consumer/node_modules/ags-platform` symlinked) → exit 0; the emitted bundle
  inlines the package **and the manifest** (`app-icons`, `schemaVersion`,
  `bar_mappings`, `DomainEventBusCore` all present after decoding).
- Prototype `node --test` over the pure ports → `tests 11, pass 11, fail 0`.
- Prototype desktop-stack typecheck (`ags types -d . -u` + `tsc -p` with
  third-party tolerance) → **0 errors in the repo tree**, 27 tolerated
  `/usr/share/ags/js/` errors, 0 elsewhere → PASS.

Verify (after this change):

- `diff -r dotfiles-v3/dotfiles/config/ags/platform/ports ports` → identical;
  `diff` of `index.ts` / `package.json` → identical; `adapters/` differs only at
  `icon-registry.ts` line 2.
- `node --test` → `pass 11, fail 0`.
- `ags bundle … --gtk 4` via a `node_modules/ags-platform` shortcut → exit 0.
- `openspec validate publish-ags-platform --type change` → valid.

## What Changes

### 1. Publish the proven package (AD-17, AD-20)

The package is imported to **this repo's root**, byte-faithful:

```
ags-platform/
  package.json        # name ags-platform + the exports map (boundary)
  index.ts            # the public surface
  ports/              # PURE — no gi://, no ags
  adapters/           # host-bound (Gio, Gtk, gnim, ags)
  icons.json          # the build-time manifest adapters/icon-registry.ts imports
```

The **only** path the import needs adjusting is the icon manifest:
`adapters/icon-registry.ts` imports `../../icons.json` in-place in dotfiles
(a sibling of the package root). At the repo root the manifest is one level
shallower, so the specifier becomes `../icons.json` and `icons.json` is imported
alongside the package. Every other file is byte-identical to the dotfiles source.

### 2. Define the package boundary — the `exports` map (AD-17)

`package.json`'s `exports` map **is** the boundary:

```json
"exports": {
  ".": "./index.ts",
  "./ports/*": "./ports/*.ts",
  "./adapters/*": "./adapters/*.ts"
}
```

AGS's embedded esbuild resolves `ags-platform`, `ags-platform/ports/<name>` and
`ags-platform/adapters/<name>` by bare specifier through a `node_modules`
shortcut (AD-17). A committed test (`tests/exports.test.ts`) asserts the map and
that every declared target resolves to a file.

### 3. Decide the test-import shape (resolves the Open Question)

**Decision: tests import the pure ports by RELATIVE path with explicit `.ts`
extensions** (e.g. `from "../ports/event-client.ts"`), run by `node --test` with
Node's native type stripping — **not** by the `ags-platform` bare specifier.

Why: Node rejects `.ts` under `node_modules`
(`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, observed above), so a bare
specifier cannot be used by the Node test runner; a resolve hook that pretends
the package is not under `node_modules` would test a layout that does not ship.
Relative imports exercise the **same source files** with **zero build step**,
need **no desktop stack**, and keep the suite runnable on a **stock runner**
(AD-23). This mirrors the in-place extraction's own pure test project. AGS's
embedded esbuild (not Node) still resolves the bare specifier for real apps.

### 4. CI: stock pure tests + self-hosted desktop typecheck (AD-23)

`.github/workflows/ci.yml` with two jobs:

- **`pure`** — stock `ubuntu-latest`: `make test` (pure `node --test`) and the
  pure tests typecheck (`make typecheck-tests`); no AGS, no GTK.
- **`desktop-typecheck`** — `[self-hosted, linux]`: `ags types -d . -u` (generate
  the machine's GIR declarations + `ags`/`gnim` links) then `make typecheck`.

`make typecheck` follows the proven `bar-typecheck` gate shape: it runs `tsc`
and **fails only on errors in this repo's tree**; third-party errors under
`/usr/share/ags/js/` (the AGS runtime's own `.ts`) are tolerated and counted.
`@girs/`, the `ags types`-generated `tsconfig.json`, and `node_modules/` are
gitignored.

### 5. Keep this repo's governance green

`openspec validate`, and the `Makefile` targets (`help`, `test`,
`typecheck-tests`, `typecheck`) stay green on the stock runner; the
desktop-stack typecheck runs on the self-hosted runner per AD-23.

## Out of scope

- **The `node_modules` shortcut / provisioning install** (AD-17 step 5,
  `ags-consume-platform`): this change gives the package its published shape; it
  does not install it or wire dotfiles-v3.
- **`contracts` repo** and the contract codegen (AD-6): unchanged.
- **`ags-apps`** and the apps' migration (AD-20 step 8): unchanged.
- **The runtime manifest ownership move** (AD-16/AD-21): `icons.json` remains a
  runtime-produced artifact; the committed copy is the build-time manifest the
  adapter imports for a self-contained typecheck (see Open Questions).
- **Framework unit versioning/rollback** (AD-17/AD-23): the `<version>`
  directory mechanism is the provisioning step's, not this one.

## Impact

- **New (package):** `ports/`, `adapters/`, `index.ts`, `package.json`,
  `icons.json` at the repo root (imported from dotfiles-v3, read-only source).
- **New (tooling):** `tsconfig.platform.json`, `tests/tsconfig.tests.json`,
  `tests/*.test.ts`, `.github/workflows/ci.yml`, updated `Makefile`,
  `.gitignore` entries (`@girs/`, generated `tsconfig.json`).
- **No behaviour change:** the package code is the proven extraction, unchanged
  except the one manifest specifier.
