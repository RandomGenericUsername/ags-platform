/**
 * App-scoped Skin wiring, with the host injected.
 *
 * The display adapter (`./skin`) binds this module to GLib/GTK and exports the
 * bar's default `skin` singleton. This file stays free of `gi://*` so the
 * per-app path resolution and instance isolation are exercised by the stock
 * `node --test` runner.
 *
 * A consumer's skin is scoped by its AGS `configDir`:
 *
 * - `$XDG_CONFIG_HOME/<configDir>/skin.css` — that app's runtime-expanded CSS;
 * - `$XDG_STATE_HOME/dotfiles/current/skin.json` — the one shared token map;
 * - the palette artifacts are shared and unchanged.
 *
 * The platform carries no app list: `configDir` is an input, and the bar's
 * default is just `createAppSkin({ configDir: "ags" })`.
 */

import {
  createSkin,
  type Skin,
  type SkinCssSink,
} from "../ports/skin.ts";

/** The four artifacts one app-scoped Skin reads. */
export interface AppSkinPaths {
  /** `$XDG_CONFIG_HOME/<configDir>/skin.css`. */
  skinCssPath: string;
  /** `$XDG_STATE_HOME/dotfiles/current/skin.json` (shared by every app). */
  skinJsonPath: string;
  /** `$XDG_CONFIG_HOME/ags/colors.css` (the stable legacy palette sheet). */
  legacyCssPath: string;
  /** `$XDG_STATE_HOME/dotfiles/current/colors.yaml` (the typed palette). */
  palettePath: string;
}

/** The host contract the app-scoped factory needs; the adapter supplies it. */
export interface AppSkinScopeOptions {
  /** AGS config directory name, e.g. `ags` or `ags-clipboard`. */
  configDir: string;
  /** `$XDG_CONFIG_HOME`. */
  configHome: string;
  /** `$XDG_STATE_HOME`. */
  stateHome: string;
  /** The single replacing provider sink for this instance. */
  sink: SkinCssSink;
  /** Read a UTF-8 artifact; `null` means the artifact is absent. */
  readFile(path: string): string | null;
  /** Watch one path; the core starts one watcher per skin artifact. */
  watchFile(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

/**
 * Resolve the consumer pointers for one `configDir`.
 *
 * The CSS pointer is per app; the token map and both palette artifacts are
 * shared. This is the contracts v0.6.0 "Template set and consumer artifacts"
 * contract, not an app-specific map.
 */
export function resolveAppSkinPaths(
  configDir: string,
  configHome: string,
  stateHome: string,
): AppSkinPaths {
  return {
    skinCssPath: `${configHome}/${configDir}/skin.css`,
    skinJsonPath: `${stateHome}/dotfiles/current/skin.json`,
    legacyCssPath: `${configHome}/ags/colors.css`,
    palettePath: `${stateHome}/dotfiles/current/colors.yaml`,
  };
}

/**
 * Build one app-scoped Skin. Every call gets its own `Skin` core, watchers and
 * (through the adapter's default) its own replacing sink; two instances never
 * share a provider or a monitor.
 */
export function createScopedSkin(options: AppSkinScopeOptions): Skin {
  return createSkin({
    ...resolveAppSkinPaths(options.configDir, options.configHome, options.stateHome),
    sink: options.sink,
    readFile: options.readFile,
    watchFile: options.watchFile,
    onError: options.onError,
  });
}
