/**
 * App-scoped Appearance wiring, with the host injected.
 *
 * The display adapter (`./appearance`) binds this module to GLib/GTK and
 * exports the public `createAppearance`. This file stays free of `gi://*` so
 * the per-app path resolution and the one-generation/one-apply behavior are
 * exercised by the stock `node --test` runner.
 *
 * A consumer is scoped by its AGS `configDir`:
 *
 * - watch `$XDG_STATE_HOME/dotfiles/current/appearance` — the ONE repointed hop;
 * - read `$XDG_CONFIG_HOME/<configDir>/appearance.css` — the stable convenience
 *   link into the current generation;
 * - read `$XDG_STATE_HOME/dotfiles/current/appearance/tokens.json` — the
 *   resolved v2 token document through the pointer.
 *
 * The platform carries no app list: `configDir` is an input.
 */

import {
  createAppearance,
  type Appearance,
  type AppearanceCssSink,
} from "../ports/appearance.ts";
import type { ReactiveRuntime } from "../ports/reactive.ts";

/** The three paths one app-scoped Appearance reads/watches. */
export interface AppAppearancePaths {
  /** `$XDG_STATE_HOME/dotfiles/current/appearance` — the only watch path. */
  watchPath: string;
  /** `$XDG_CONFIG_HOME/<configDir>/appearance.css` (read, never watched). */
  appearanceCssPath: string;
  /** `$XDG_STATE_HOME/dotfiles/current/appearance/tokens.json`. */
  tokensPath: string;
}

/** The host contract the app-scoped factory needs; the adapter supplies it. */
export interface AppAppearanceScopeOptions {
  /** AGS config directory name, e.g. `ags` or `ags-clipboard`. */
  configDir: string;
  /** `$XDG_CONFIG_HOME`. */
  configHome: string;
  /** `$XDG_STATE_HOME`. */
  stateHome: string;
  /** The single replacing provider sink for this instance. */
  sink: AppearanceCssSink;
  /** The reactive runtime used by `value(path, fallback)`. */
  runtime: ReactiveRuntime;
  /** Read a UTF-8 artifact; `null` means the artifact is absent. */
  readFile(path: string): string | null;
  /** Watch one path; the core starts exactly one watcher. */
  watchFile(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

/**
 * Resolve the consumer paths for one `configDir`.
 *
 * `current/appearance` is the ONE monitored hop. The config `appearance.css`
 * is a stable convenience link and is deliberately a read path only; watching
 * it would repeat the v1 second-hop defect.
 */
export function resolveAppearancePaths(
  configDir: string,
  configHome: string,
  stateHome: string,
): AppAppearancePaths {
  const pointer = `${stateHome}/dotfiles/current/appearance`;
  return {
    watchPath: pointer,
    appearanceCssPath: `${configHome}/${configDir}/appearance.css`,
    tokensPath: `${pointer}/tokens.json`,
  };
}

/**
 * Build one app-scoped Appearance. Every call gets its own provider sink,
 * watcher and token state; two instances never share display state.
 */
export function createScopedAppearance(options: AppAppearanceScopeOptions): Appearance {
  return createAppearance({
    ...resolveAppearancePaths(options.configDir, options.configHome, options.stateHome),
    sink: options.sink,
    runtime: options.runtime,
    readFile: options.readFile,
    watchFile: options.watchFile,
    onError: options.onError,
  });
}
