/**
 * App-scoped Appearance wiring, with the host injected.
 *
 * The display adapter (`./appearance`) binds this module to GLib/GTK and
 * exports the public `createAppearance`. This file stays free of `gi://*` so
 * the per-app path resolution and the one-generation/one-apply behavior are
 * exercised by the stock `node --test` runner.
 *
 * A consumer is scoped by its AGS `configDir` and reads ONLY the v3 state
 * plane:
 *
 * - watch `$XDG_STATE_HOME/dotfiles/current` — the ONE committed hop;
 * - read `current/manifest.json` to verify the generation;
 * - read `current/appearance/<configDir>.css` and
 *   `current/appearance/tokens.json` (or the immutable
 *   `generations/<genHash>/...` first).
 *
 * There is no config-home read path, no per-app convenience link and no v1/v2
 * skin path. The platform carries no app list: `configDir` is an input.
 */

import {
  createAppearance as createAppearanceCore,
  resolveAppearancePaths,
  type Appearance,
  type AppearanceCssSink,
  type AppearancePaths,
} from "../ports/appearance.ts";
import type { ReactiveRuntime } from "../ports/reactive.ts";

export { resolveAppearancePaths };
export type { AppearancePaths };

/** The host contract the app-scoped factory needs; the adapter supplies it. */
export interface AppAppearanceScopeOptions {
  /** AGS config directory name, e.g. `ags` or `ags-clipboard`. */
  configDir: string;
  /** `$XDG_STATE_HOME`; every read is below `<stateHome>/dotfiles/`. */
  stateHome: string;
  /** The single replacing provider sink for this instance. */
  sink: AppearanceCssSink;
  /** The reactive runtime used by `value(path, fallback)`. */
  runtime: ReactiveRuntime;
  /** Read a UTF-8 artifact; `null` means the artifact is absent. */
  readFile(path: string): string | null;
  /** Watch one path; the core starts exactly one watcher on `current`. */
  watchFile(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

/**
 * Build one app-scoped Appearance. Every call gets its own provider sink,
 * watcher and token state; two instances never share display state.
 */
export function createScopedAppearance(options: AppAppearanceScopeOptions): Appearance {
  return createAppearanceCore({
    configDir: options.configDir,
    paths: resolveAppearancePaths(options.configDir, options.stateHome),
    sink: options.sink,
    runtime: options.runtime,
    readFile: options.readFile,
    watchFile: options.watchFile,
    onError: options.onError,
  });
}
