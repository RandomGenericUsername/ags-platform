/**
 * The Theme port (spine AD-13; doc 101 §11 named the seam, §4 defined no port).
 *
 * A `Theme` adapter applies the palette (`colors.gtk.css`) and every app routes
 * theming through it, so the direct `app.apply_css` calls and the three
 * duplicated `theme.ts` copies stop drifting. This module holds the port and the
 * injected CSS sink; the adapter supplies the display and the stable artifact
 * path.
 *
 * WHY THE SINK IS INJECTED. Applying CSS needs the GTK display (a `gi://`
 * import); deciding WHICH artifact to apply is policy that should be pinned by a
 * test. The core takes the stable palette path once and hands it to the sink, so
 * a fake sink proves the adapter applies the stable pointer — never a generation
 * path, which would cache a stale palette after `wallpaper.state` repoints the
 * symlink (review F9).
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

export interface Theme {
  /** Apply the palette to the display. */
  apply(): void;
}

/** The one thing the port needs from the host: put a CSS file on the display. */
export interface CssSink {
  apply(path: string): void;
}

/**
 * A provider that `add` returned. Opaque to the sink: only the host knows how
 * to remove it.
 */
export type CssProviderHandle = object;

/**
 * The display-side half of a provider-owned CSS sink. The host creates the
 * provider, adds it to the display, and can remove exactly the handle it
 * returned — no shared/global provider list is involved.
 */
export interface CssProviderHost {
  /** Create a provider for `path` and add it to the display. */
  add(path: string): CssProviderHandle;
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
    apply(path: string): void {
      const next = host.add(path);
      const previous = current;
      // Track the new provider before removing the old one: if removal fails,
      // the sink still owns the provider it just installed.
      current = next;
      if (previous !== null) host.remove(previous);
    },
  };
}

/**
 * `palettePath` is the STABLE pointer (`colors.css`), not the runtime's
 * generation path (`current/colors.gtk.css`): the stable pointer is repointed
 * when the palette changes, so re-applying it is never stale (F9).
 */
export function createTheme(palettePath: string, sink: CssSink): Theme {
  return {
    apply(): void {
      sink.apply(palettePath);
    },
  };
}
