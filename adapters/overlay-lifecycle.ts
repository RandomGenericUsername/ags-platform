/**
 * The GLib binding of the Overlay Lifecycle primitive (spine AD-2; the pure
 * core + the pattern live in `../ports/overlay-lifecycle`).
 *
 * The pure core owns the order and the skip/defer decision; this file supplies
 * the one thing it cannot: the host's idle queue. `GLib.idle_add` with
 * `PRIORITY_DEFAULT_IDLE` is exactly the call hypr-pano's `map` handler made
 * (`ags-apps` 725ffdf): a one-shot callback that runs after the surface has
 * been presented and the current event has been handled, which is what keeps
 * the ~430 ms rebuild off the map -> first-frame path.
 *
 * THE SCHEDULER IS A PORT BINDING, NOT A GLOBAL. The pure core takes an
 * `OverlayScheduler`; exporting the GLib implementation here (and the
 * `overlayLifecycle` convenience that pre-binds it) means the core never
 * imports `gi://*`, so `make test` exercises the state machine with a stub.
 */

import GLib from "gi://GLib?version=2.0";
import {
  createOverlayLifecycle,
  type OverlayHooks,
  type OverlayLifecycle,
  type OverlayScheduler,
} from "../ports/overlay-lifecycle";

/**
 * The one-shot default-idle scheduler. `defer` never reschedules: the pattern
 * needs a single deferred rebuild, and the core re-checks staleness inside the
 * callback, so a second pass would be a no-op anyway.
 */
export const idleScheduler: OverlayScheduler = {
  defer(task: () => void): void {
    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      task();
      return false; // remove the source: one-shot
    });
  },
};

/**
 * Create a surface's lifecycle controller bound to the host's idle queue.
 *
 * WHY THIS IS NOT CALLED `openOverlayLifecycle`. It does not open anything: it
 * builds the controller ONCE per surface, and the app calls `.open()` on each
 * `map` (and `.close()` on each `unmap`). A name that read as an event handler
 * would invite a per-map call, which would discard the remembered
 * `builtKey` and lose the warm-reopen path — the whole point of the primitive.
 */
export function overlayLifecycle(hooks: OverlayHooks): OverlayLifecycle {
  return createOverlayLifecycle(hooks, idleScheduler);
}
