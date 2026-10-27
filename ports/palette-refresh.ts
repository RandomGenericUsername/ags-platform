/**
 * The app-side half of the fixed `palette-refresh` protocol (spine AD-27;
 * contracts `ags-app-refresh.md` and `schemas/ags-app-refresh-result.schema.json`).
 *
 * AGS's request transport is a STRING: the app registers
 * `requestHandler(argv, res)` and answers with `res(JSON.stringify(...))`.
 * A JSON object literal becomes `[object Object]` on stdout. This helper is the
 * one place an app should encode that answer.
 *
 * THE INVARIANTS:
 * - exactly one response per request, on every path (applied, deferred, busy,
 *   declared failure, thrown/rejected error, malformed argv, invalid result);
 * - the response is always a string produced by `JSON.stringify`;
 * - the permitted shapes are exactly the three the protocol allows;
 * - `ok:true` without `deferred` means the refresh COMPLETED. The helper never
 *   schedules work after it; an async refresh is not answered until its promise
 *   settles, and a "come back later" app must return `deferred` (or `busy`);
 * - a second request while an async refresh is in flight gets the protocol's
 *   retryable `{"ok":false,"error":"busy","retryable":true}`, never a queue.
 *
 * The helper does not touch app state, restart anything, or apply CSS. The app
 * supplies the non-destructive refresh; preserving unsaved/transient state is
 * the app's declared responsibility (AD-27, `holdsUnsavedState`).
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

/** The fixed command name (`argv[0]`) of the refresh request (AD-27). */
export const PALETTE_REFRESH_COMMAND = "palette-refresh";

/** What the app's refresh function reports after doing (or deferring) the work. */
export type PaletteRefreshResult =
  | { status: "applied" }
  | { status: "deferred"; reason: string }
  | { status: "busy" }
  | { status: "failed"; error: string; retryable: boolean };

/**
 * The app-supplied refresh. The `appearanceHash` is the sole argument and is
 * opaque; the function must converge to that appearance, not toggle state.
 * A synchronous result is preferred (it lets the helper answer immediately);
 * a promise is accepted, and the request stays unanswered until it settles.
 */
export type PaletteRefresh = (
  appearanceHash: string,
) => PaletteRefreshResult | Promise<PaletteRefreshResult>;

/** The AGS `requestHandler` shape; `respond` must receive a string. */
export type PaletteRefreshRequestHandler = (
  argv: readonly string[],
  respond: (response: string) => void,
) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

/**
 * Reject any returned object that is not one of the permitted outcomes. This
 * is what makes a response object such as `{ ok: true }` a terminal failure
 * instead of something that could be passed through to AGS.
 */
function normalizeResult(value: unknown): PaletteRefreshResult | null {
  if (!isRecord(value)) return null;

  switch (value.status) {
    case "applied":
      return hasExactKeys(value, ["status"]) ? { status: "applied" } : null;
    case "busy":
      return hasExactKeys(value, ["status"]) ? { status: "busy" } : null;
    case "deferred":
      return hasExactKeys(value, ["reason", "status"]) &&
        typeof value.reason === "string" &&
        value.reason.length > 0
        ? { status: "deferred", reason: value.reason }
        : null;
    case "failed":
      return hasExactKeys(value, ["error", "retryable", "status"]) &&
        typeof value.error === "string" &&
        value.error.length > 0 &&
        typeof value.retryable === "boolean"
        ? {
            status: "failed",
            error: value.error,
            retryable: value.retryable,
          }
        : null;
    default:
      return null;
  }
}

function encodeResult(result: PaletteRefreshResult): string {
  switch (result.status) {
    case "applied":
      return JSON.stringify({ ok: true });
    case "deferred":
      return JSON.stringify({ ok: true, deferred: result.reason });
    case "busy":
      return JSON.stringify({ ok: false, error: "busy", retryable: true });
    case "failed":
      return JSON.stringify({
        ok: false,
        error: result.error,
        retryable: result.retryable,
      });
  }
}

function errorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : String(error);
  return message.trim().length > 0 ? message : "palette refresh failed";
}

const MALFORMED: PaletteRefreshResult = {
  status: "failed",
  error: "malformed palette-refresh request",
  retryable: false,
};

const INVALID_RESULT: PaletteRefreshResult = {
  status: "failed",
  error: "invalid palette-refresh result",
  retryable: false,
};

/**
 * Wrap an app refresh function as an AGS `requestHandler`.
 *
 * The returned handler validates `["palette-refresh", "<appearance-hash>"]`,
 * invokes the refresh once, and answers exactly once. Unexpected throws and
 * rejections are retryable failures: the next appearance trigger retries them.
 * A condition the app knows is terminal must be returned explicitly as
 * `{ status: "failed", retryable: false }`. A refresh that cannot finish inside
 * the runtime's 5 s window must return `deferred` (or busy); a promise that
 * never settles cannot be answered by the helper without scheduling work after
 * the fact, which the protocol forbids.
 *
 * Assign it directly in `app.start`:
 *
 * ```ts
 * requestHandler: createPaletteRefreshHandler((appearanceHash) => {
 *   theme.apply()
 *   return { status: "applied" }
 * }),
 * ```
 */
export function createPaletteRefreshHandler(
  refresh: PaletteRefresh,
): PaletteRefreshRequestHandler {
  let inFlight = false;

  return (argv, respond) => {
    // Per-request: a second AGS invocation has its own response channel.
    let answered = false;
    const send = (result: PaletteRefreshResult): void => {
      if (answered) return;
      answered = true;
      respond(encodeResult(result));
    };

    // The handler receives exactly ["palette-refresh", "<hash>"]. Anything
    // else is a malformed request, not a successful refresh (AD-27).
    if (
      argv.length !== 2 ||
      argv[0] !== PALETTE_REFRESH_COMMAND ||
      typeof argv[1] !== "string" ||
      argv[1].length === 0
    ) {
      send(MALFORMED);
      return;
    }

    if (inFlight) {
      send({ status: "busy" });
      return;
    }

    const appearanceHash = argv[1];
    let result: PaletteRefreshResult | Promise<PaletteRefreshResult>;
    inFlight = true;
    try {
      result = refresh(appearanceHash);
    } catch (error) {
      inFlight = false;
      send({ status: "failed", error: errorMessage(error), retryable: true });
      return;
    }

    if (isPromiseLike(result)) {
      // Do not answer until the refresh has actually settled: ok:true without
      // deferred promises that no work remains. The `answered` guard also makes
      // a misbehaving thenable unable to produce a second response.
      Promise.resolve(result).then(
        (settled) => {
          inFlight = false;
          send(normalizeResult(settled) ?? INVALID_RESULT);
        },
        (error: unknown) => {
          inFlight = false;
          send({ status: "failed", error: errorMessage(error), retryable: true });
        },
      );
      return;
    }

    inFlight = false;
    send(normalizeResult(result) ?? INVALID_RESULT);
  };
}
