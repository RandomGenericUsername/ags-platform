/**
 * The Overlay Lifecycle primitive (spine AD-2/AD-4; proven in `ags-apps`
 * commit `725ffdf`, hypr-pano `ui/PanoWindow.tsx`).
 *
 * THE PATTERN. An on-demand overlay surface (a layer-shell window that
 * maps/unmaps) used to build its heavy content SYNCHRONOUSLY in its `map`
 * handler. Measured on hypr-pano's 141-item clipboard history, `map -> first
 * frame` took 447-504 ms, because ~430 ms of card construction ran before the
 * surface was presented. Reordering to `present()` first, a cheap hydration
 * pass (read + visibility + highlight), and a DEFERRED rebuild (on the idle
 * queue) took `map -> first frame` to 5.5 ms cold / ~1 ms warm; a reopen whose
 * content signature is unchanged skips the rebuild entirely.
 *
 * This module is the PURE half: the ordering and the skip/defer decision, with
 * every effect (`present`, `hydrate`, `build`) and the scheduler injected. It
 * imports no `ags` and no `gi://*`, so `node --test` drives the whole state
 * machine with a stub scheduler and no desktop stack (AD-2/AD-4). The GLib
 * binding lives in `../adapters/overlay-lifecycle`.
 *
 * WHY THE HOOKS ARE INJECTED. The order (present -> hydrate -> defer build) and
 * the gate (rebuild only when the content signature changed) are POLICY and
 * belong in a pure, testable core; presenting a surface, reading a document and
 * constructing widgets are the app's and the host's. Injecting them lets a test
 * assert the order with counters, exactly as the notifier's injected sinks do.
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

/**
 * The app-supplied effects. The core owns their ORDER and whether the deferred
 * one runs at all.
 */
export interface OverlayHooks {
  /**
   * Ask the compositor to present/focus the surface. Runs FIRST and
   * synchronously: the surface must be on screen before any heavy work.
   * App-specific focus (`entry.grab_focus()`) belongs here too.
   */
  present(): void;
  /**
   * The cheap synchronous pass: read the source, set visibility, move the
   * highlight. MUST update whatever `key()` derives from. MUST NOT construct or
   * tear down the heavy widgets.
   */
  hydrate(): void;
  /** The expensive rebuild. Runs deferred, and only when the content is stale. */
  build(): void;
  /**
   * The content signature of what should be shown right now, derived from the
   * state `hydrate()` just refreshed (and from the app's own live-update state).
   * Pure and cheap: two equal signatures mean the built widgets still describe
   * the content, so the rebuild is skipped.
   */
  key(): string;
}

/**
 * The injected scheduler. Production binds
 * `GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, ...)` (`../adapters/overlay-lifecycle`);
 * a test binds a queue it drains by hand, which is what makes "deferred"
 * observable without a desktop stack.
 */
export interface OverlayScheduler {
  /** Run `task` once, on the next idle. */
  defer(task: () => void): void;
}

/**
 * The controller one overlay surface holds for its lifetime. Create ONE per
 * surface (per monitor); the built-content signature it remembers is what makes
 * a warm reopen cheap, so it must outlive a single map/unmap cycle.
 */
export interface OverlayLifecycle {
  /** Call from the surface's `map` handler. */
  open(): void;
  /** Call from the surface's `unmap` handler. */
  close(): void;
  /** Content changed while mapped (a live push, a keystroke). */
  refresh(): void;
  /** The signature the currently built content corresponds to, or null. */
  readonly builtKey: string | null;
}

/**
 * The canonical content signature: the `kind:hash` join from the proven
 * pattern. A NEWLINE separator (not a comma) so an item id may contain
 * punctuation; the parts are tokens (`kind:hash`), never free text, so a part
 * cannot itself contain the separator and collide two different lists.
 */
export function contentSignature(parts: readonly string[]): string {
  return parts.join("\n");
}

export function createOverlayLifecycle(
  hooks: OverlayHooks,
  scheduler: OverlayScheduler,
): OverlayLifecycle {
  let mapped = false;
  let builtKey: string | null = null;

  //: Recompute the signature and build only when it differs from what is on
  //: screen. Shared by the deferred path and `refresh()` so both re-check.
  function buildIfStale(): void {
    const key = hooks.key();
    if (key === builtKey) return;
    // Mark BEFORE build: the signature records what this build is FOR, and a
    // callback fired re-entrantly during build() must not double-build.
    builtKey = key;
    hooks.build();
  }

  return {
    open(): void {
      mapped = true;
      hooks.present(); // 1. surface on screen first
      hooks.hydrate(); // 2. cheap: read + visibility + highlight
      if (hooks.key() === builtKey) return; // 3. unchanged -> skip the heavy rebuild
      scheduler.defer(() => {
        // 4. heavy work off the map path. Re-check: a keystroke or a live push
        //    may have changed (or already rebuilt) the content between map and
        //    this callback, and an unmap cancels it.
        if (!mapped) return;
        buildIfStale();
      });
    },
    close(): void {
      // Do NOT reset builtKey: the built content is still valid, so the next
      // open of unchanged content is the warm (~1 ms) path.
      mapped = false;
    },
    refresh(): void {
      // A hidden surface just holds the newer state; the next open decides.
      if (!mapped) return;
      buildIfStale();
    },
    get builtKey(): string | null {
      return builtKey;
    },
  };
}
