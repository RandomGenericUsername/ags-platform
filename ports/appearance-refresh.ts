/**
 * The app-side `palette-refresh` handler for the v2 appearance plane.
 *
 * The transport is unchanged (contracts `ags-app-refresh.md`): the runtime
 * sends `["palette-refresh", "<appearanceHash>"]` and expects exactly one JSON
 * string response. What changes is the handler contract: the platform re-applies
 * the WHOLE appearance (palette + skin + mode) before any app-owned derived
 * work. An app can no longer forget to re-apply the skin.
 *
 * Idempotence is by appearance hash: a repeated request for the same hash still
 * calls `appearance.apply()` (cheap: identical content is coalesced), but does
 * not run the app work again. A non-`applied` outcome does not advance the hash,
 * so the runtime retries.
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

import type { Appearance } from "./appearance.ts";
import {
  createPaletteRefreshHandler,
  type PaletteRefreshRequestHandler,
  type PaletteRefreshResult,
} from "./palette-refresh.ts";

/**
 * Genuinely app-owned derived work (icon rebuilds, raster caches). It must not
 * re-apply palette/skin; the helper already did that.
 */
export type AppearanceRefreshWork = (
  appearanceHash: string,
) => PaletteRefreshResult | Promise<PaletteRefreshResult> | void;

function isPromiseLike(value: unknown): value is PromiseLike<PaletteRefreshResult> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

/**
 * Wrap the appearance apply and optional app work as the AGS
 * `palette-refresh` request handler.
 *
 * ```ts
 * app.start({
 *   requestHandler: createAppearanceRefreshHandler(appearance, () => {
 *     refreshDerivedSurfaces()
 *     return { status: "applied" }
 *   }),
 * })
 * ```
 */
export function createAppearanceRefreshHandler(
  appearance: Pick<Appearance, "apply">,
  work?: AppearanceRefreshWork,
): PaletteRefreshRequestHandler {
  let appliedHash: string | null = null;

  return createPaletteRefreshHandler((appearanceHash) => {
    // Always re-apply the whole appearance first. The core coalesces identical
    // content, so a duplicate request is safe and never double-installs.
    appearance.apply();

    if (appliedHash === appearanceHash) return { status: "applied" };
    if (work === undefined) {
      appliedHash = appearanceHash;
      return { status: "applied" };
    }

    const result = work(appearanceHash);
    if (isPromiseLike(result)) {
      return Promise.resolve(result).then((settled) => {
        if (settled === undefined) {
          appliedHash = appearanceHash;
          return { status: "applied" };
        }
        if (settled.status === "applied") appliedHash = appearanceHash;
        return settled;
      });
    }
    if (result === undefined) {
      // A void app-work result means "nothing else to do"; the appearance
      // apply above completed, so the protocol can answer applied.
      appliedHash = appearanceHash;
      return { status: "applied" };
    }
    if (result.status === "applied") appliedHash = appearanceHash;
    return result;
  });
}
