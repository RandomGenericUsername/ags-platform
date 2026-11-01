/**
 * The Theme port (spine AD-13; doc 101 §11 named the seam, §4 defined no port).
 *
 * A `Theme` adapter owns THREE things for every app, in ONE mechanism (REQ-013):
 *
 * 1. the CSS projection — one GTK provider carrying the legacy `colors.css`
 *    verbatim plus one `@define-color <role> <hex>;` per declared palette role;
 * 2. the typed palette — `palette()` parses the runtime `current/colors.yaml`
 *    (see `./palette`) and returns the role map;
 * 3. the change subscription — `subscribe(listener)` watches the palette file
 *    once, reloads + re-applies the CSS, and then notifies every listener.
 *
 * WHY THE SINK IS INJECTED. Applying CSS needs the GTK display (a `gi://`
 * import); deciding WHICH artifact to apply and parsing the palette are policy
 * that should be pinned by a test. The adapter resolves the two stable
 * artifacts (`colors.css`, `colors.yaml`) and supplies a file reader and a
 * monitor; a fake sink/reader/monitor proves replacement, parsing and cleanup
 * with no desktop stack.
 *
 * WHY ONE PROVIDER, COMPOSED. The legacy `@color_*` aliases and the role names
 * must both be visible to the SAME provider: two providers would be two
 * mechanisms to replace and would violate the one-provider invariant (BUG-001).
 * So `apply()` reads `colors.css`, appends the role block, and installs the
 * result as a single provider. The legacy text is untouched, so every current
 * `@color_*` app resolves exactly as before.
 *
 * ORDER OF OPERATIONS. A refresh reads and composes the next sheet BEFORE
 * touching the display, then adds the next provider before removing the
 * previous one. A malformed palette or a failed read therefore leaves the
 * previous, still-correct provider installed. Only the handle this sink added
 * is ever removed: the app stylesheet installed by `app.start({ css })` and the
 * GTK theme are never touched.
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

import {
  parsePaletteYaml,
  renderPaletteCss,
  type Palette,
} from "./palette.ts";

/** A palette change listener; called only after the new palette is loaded. */
export type PaletteListener = (palette: Palette) => void;

export interface Theme {
  /** Load the CSS projection (legacy aliases + role defines) and apply it. */
  apply(): void;
  /**
   * The current typed palette. The first call reads and parses the runtime
   * artifact; later calls return the last successfully loaded palette.
   *
   * Throws `PaletteParseError` (or the reader's error) when the artifact is
   * missing/malformed. `apply()` degrades to legacy-only CSS in that case and
   * reports through `onError`, so an app whose only requirement is the legacy
   * theme keeps working.
   */
  palette(): Palette;
  /**
   * Subscribe to palette changes. One monitor is shared by every listener and
   * is stopped when the last unsubscribe runs. The listener is NOT called
   * synchronously on subscribe: read `palette()` for the initial value, then
   * subscribe for changes.
   */
  subscribe(listener: PaletteListener): () => void;
}

/** The one thing the port needs from the host: put CSS text on the display. */
export interface CssSink {
  apply(css: string): void;
}

/**
 * A provider that `add` returned. Opaque to the sink: only the host knows how
 * to remove it.
 */
export type CssProviderHandle = object;

/**
 * The display-side half of a provider-owned CSS sink. The host creates the
 * provider, loads the CSS text, adds it to the display, and can remove exactly
 * the handle it returned — no shared/global provider list is involved.
 */
export interface CssProviderHost {
  /** Create a provider for `css`, add it to the display, and return its handle. */
  add(css: string): CssProviderHandle;
  /** Remove a provider previously returned by `add`. */
  remove(provider: CssProviderHandle): void;
}

/**
 * A `CssSink` that keeps exactly ONE provider on the display per app (AD-13).
 *
 * Each apply creates and ADDS the next provider BEFORE removing the previous
 * one, so the palette is never momentarily absent from the display. The sink
 * removes only a handle it added itself: the app stylesheet installed by
 * `app.start({ css: style })` and the GTK theme are never touched.
 *
 * This exists because the AGS app CSS helper creates, adds and RETAINS a
 * provider on every call. Routing palette refreshes through it accumulated one
 * provider per refresh (BUG-001).
 */
export function createReplacingCssSink(host: CssProviderHost): CssSink {
  let current: CssProviderHandle | null = null;
  return {
    apply(css: string): void {
      const next = host.add(css);
      const previous = current;
      // Track the new provider before removing the old one: if removal fails,
      // the sink still owns the provider it just installed.
      current = next;
      if (previous !== null) host.remove(previous);
    },
  };
}

/**
 * Compose the one provider's sheet: the legacy stylesheet VERBATIM, then the
 * role block. Keeping the legacy bytes at the front is what makes current
 * `@color_*` apps byte-compatible through Phase A.
 */
export function composeThemeCss(legacyCss: string, palette: Palette | null): string {
  if (palette === null) return legacyCss;
  if (legacyCss === "") return renderPaletteCss(palette);
  const separator = legacyCss.endsWith("\n") ? "" : "\n";
  return `${legacyCss}${separator}${renderPaletteCss(palette)}`;
}

/** Everything the pure Theme core needs from its host. */
export interface ThemeOptions {
  /** The STABLE legacy pointer (`colors.css` -> `current/colors.gtk.css`). */
  legacyCssPath: string;
  /** The resolved palette source (`current/colors.yaml`). */
  palettePath: string;
  /** The single replacing provider sink. */
  sink: CssSink;
  /** Read a UTF-8 text artifact; the host owns the filesystem. */
  readFile(path: string): string;
  /**
   * Watch ONE path and call `onChange` after a change. Returns the release
   * handle. The core starts at most one watcher regardless of listener count.
   */
  watchFile(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build a Theme over the host's two stable artifacts.
 *
 * Failure policy: `palette()` fails closed with `PaletteParseError`. The first
 * `apply()` degrades to the legacy sheet when the palette is missing or
 * malformed (reported through `onError`), so a missing producer cannot brick an
 * app whose CSS only needs the legacy aliases. A change reload that cannot
 * load the palette leaves the previous provider and palette in place. A failed
 * legacy read or provider install still throws, matching the old path-based
 * behaviour; a failure inside the monitor callback is reported instead of
 * thrown.
 */
export function createTheme(options: ThemeOptions): Theme {
  const { legacyCssPath, palettePath, sink, readFile, watchFile } = options;
  const report =
    options.onError ??
    ((error: unknown): void => {
      console.error(`theme: ${describe(error)}`);
    });

  let loaded: Palette | null = null;
  let stopWatching: (() => void) | null = null;
  const listeners = new Set<PaletteListener>();

  function readPalette(): Palette {
    return parsePaletteYaml(readFile(palettePath), palettePath);
  }

  /**
   * Read + compose + install. Throws only when the legacy artifact fails.
   * With `allowLegacyFallback` false (a change reload) a malformed palette
   * leaves the previous provider untouched; with true (the initial apply) the
   * legacy sheet is installed alone so current apps still work.
   */
  function install(allowLegacyFallback: boolean): Palette | null {
    // Read the legacy sheet first: a missing app palette is the same hard
    // failure it was when the sink loaded the path directly.
    const legacyCss = readFile(legacyCssPath);
    let palette: Palette | null = null;
    try {
      palette = readPalette();
    } catch (error) {
      report(error);
      if (!allowLegacyFallback) return null;
    }
    sink.apply(composeThemeCss(legacyCss, palette));
    if (palette !== null) loaded = palette;
    return palette;
  }

  function onChange(): void {
    try {
      const next = install(false);
      if (next === null) return;
      for (const listener of [...listeners]) {
        try {
          listener(next);
        } catch (error) {
          report(error);
        }
      }
    } catch (error) {
      // A failed legacy read/provider install is reported, not thrown from a
      // Gio signal callback (where it would abort unrelated signal handling).
      report(error);
    }
  }

  return {
    apply(): void {
      install(true);
    },

    palette(): Palette {
      if (loaded !== null) return loaded;
      loaded = readPalette();
      return loaded;
    },

    subscribe(listener: PaletteListener): () => void {
      listeners.add(listener);
      if (stopWatching === null) {
        stopWatching = watchFile(palettePath, onChange);
      }
      let active = true;
      return (): void => {
        if (!active) return;
        active = false;
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0 && stopWatching !== null) {
          const stop = stopWatching;
          stopWatching = null;
          stop();
        }
      };
    },
  };
}
