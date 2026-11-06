/**
 * The app-side `appearance-refresh` handler for Generations v3 (contracts
 * `v0.8.0`).
 *
 * The runtime sends exactly `["appearance-refresh", "<genHash>"]` and expects
 * one JSON-encoded string. The app MUST resolve and install the generation
 * named in the request; it never acks "whatever `current` is". The response is
 * one of:
 *
 * ```text
 * {"applied":"<genHash>"}
 * {"deferred":"reason","genHash":"<genHash>"}
 * {"failed":"reason","retryable":true|false,"genHash":"<genHash>"}
 * ```
 *
 * Every response names the REQUESTED generation. A stale `{"ok":true}` v2 ack
 * is neither produced nor accepted here.
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

import {
  GENERATION_HASH_PATTERN,
  type Appearance,
  type AppearanceApplyResult,
} from "./appearance.ts";

/** The fixed v3 command name (`argv[0]`). */
export const APPEARANCE_REFRESH_COMMAND = "appearance-refresh";

/** A schema-valid placeholder used only for a malformed request with no hash. */
const UNBOUND_HASH = "0".repeat(64);

/** The app-owned derived work result (icons/caches, never palette/skin). */
export type AppearanceRefreshWorkResult =
  | { status: "applied" }
  | { status: "deferred"; reason: string }
  | { status: "failed"; error: string; retryable: boolean };

/**
 * Genuinely app-owned derived work. It runs only after the requested
 * generation has been installed; it must not re-apply palette/skin.
 */
export type AppearanceRefreshWork = (
  genHash: string,
) => AppearanceRefreshWorkResult | Promise<AppearanceRefreshWorkResult> | void;

/** The AGS `requestHandler` shape; `respond` receives a JSON string. */
export type AppearanceRefreshRequestHandler = (
  argv: readonly string[],
  respond: (response: string) => void,
) => void;

/** The frozen v3 response union. */
export type AppearanceRefreshResponse =
  | { applied: string }
  | { deferred: string; genHash: string }
  | { failed: string; retryable: boolean; genHash: string };

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
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

/** Reject old v2 `{ok:true}` results and every other non-v3 work shape. */
function normalizeWork(value: unknown): AppearanceRefreshWorkResult | null {
  if (!isRecord(value)) return null;
  switch (value.status) {
    case "applied":
      return hasExactKeys(value, ["status"]) ? { status: "applied" } : null;
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
        ? { status: "failed", error: value.error, retryable: value.retryable }
        : null;
    default:
      return null;
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().length > 0 ? message : "appearance refresh failed";
}

function encode(response: AppearanceRefreshResponse): string {
  return JSON.stringify(response);
}

/**
 * Convert a generation-bound apply outcome into the frozen response union.
 * A hash mismatch is a retryable failure for the REQUESTED generation, never
 * an applied ack for another one.
 */
function responseFor(
  requested: string,
  outcome: AppearanceApplyResult,
): AppearanceRefreshResponse {
  if (outcome.status === "applied") {
    if (outcome.genHash !== requested) {
      return {
        failed: `applied generation ${outcome.genHash} does not match the request`,
        retryable: true,
        genHash: requested,
      };
    }
    return { applied: requested };
  }
  if (outcome.status === "deferred") {
    return { deferred: outcome.reason, genHash: requested };
  }
  return {
    failed: outcome.reason,
    retryable: outcome.retryable,
    genHash: requested,
  };
}

/**
 * Wrap the generation-bound appearance apply and optional app work as the AGS
 * `appearance-refresh` request handler.
 *
 * The handler validates the exact command shape, resolves the REQUESTED
 * generation, and answers exactly once. A request for a generation that is no
 * longer `current`, or is absent, answers deferred with that same hash and
 * installs nothing. Work is idempotent by generation hash; deferred/failed work
 * does not advance the applied hash.
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
  appearance: Pick<Appearance, "applyGeneration">,
  work?: AppearanceRefreshWork,
): AppearanceRefreshRequestHandler {
  let inFlight = false;
  let completedHash: string | null = null;

  return (argv, respond) => {
    // Per-request: a second AGS invocation has its own response channel.
    let answered = false;
    const send = (response: AppearanceRefreshResponse): void => {
      if (answered) return;
      answered = true;
      respond(encode(response));
    };

    // The handler receives exactly ["appearance-refresh", "<64-hex>"]. Any
    // other shape is malformed and MUST NOT be treated as a successful
    // refresh. The old v2 palette-refresh command is not accepted.
    const candidate = argv[1];
    const requested =
      argv.length === 2 &&
      argv[0] === APPEARANCE_REFRESH_COMMAND &&
      typeof candidate === "string" &&
      GENERATION_HASH_PATTERN.test(candidate)
        ? candidate
        : null;
    if (requested === null) {
      send({
        failed: "malformed appearance-refresh request",
        retryable: false,
        // There is no requested generation; a schema-valid sentinel makes the
        // caller reject the hash mismatch instead of treating a boolean ack
        // as success.
        genHash:
          typeof candidate === "string" && GENERATION_HASH_PATTERN.test(candidate)
            ? candidate
            : UNBOUND_HASH,
      });
      return;
    }

    if (inFlight) {
      send({ deferred: "busy", genHash: requested });
      return;
    }
    inFlight = true;

    const finish = (response: AppearanceRefreshResponse): void => {
      inFlight = false;
      send(response);
    };

    const finishWork = (result: AppearanceRefreshWorkResult): void => {
      switch (result.status) {
        case "applied":
          completedHash = requested;
          finish({ applied: requested });
          return;
        case "deferred":
          finish({ deferred: result.reason, genHash: requested });
          return;
        case "failed":
          finish({
            failed: result.error,
            retryable: result.retryable,
            genHash: requested,
          });
          return;
      }
    };

    const invalidWork = (): void => {
      finish({
        failed: "invalid appearance-refresh work result",
        retryable: false,
        genHash: requested,
      });
    };

    let outcome: AppearanceApplyResult;
    try {
      outcome = appearance.applyGeneration(requested);
    } catch (error) {
      finish({
        failed: errorMessage(error),
        retryable: true,
        genHash: requested,
      });
      return;
    }

    const response = responseFor(requested, outcome);
    if (!("applied" in response)) {
      finish(response);
      return;
    }

    // The exact generation is installed. The app-owned derived work runs only
    // once per successful generation; a repeated request still re-verifies
    // `current` through applyGeneration before this point.
    if (completedHash === requested) {
      finish({ applied: requested });
      return;
    }
    if (work === undefined) {
      completedHash = requested;
      finish({ applied: requested });
      return;
    }

    let result: ReturnType<AppearanceRefreshWork>;
    try {
      result = work(requested);
    } catch (error) {
      finish({
        failed: errorMessage(error),
        retryable: true,
        genHash: requested,
      });
      return;
    }

    if (isPromiseLike(result)) {
      // Do not answer until the work fully settles. The `answered` guard also
      // prevents a misbehaving thenable from producing a second response.
      Promise.resolve(result).then(
        (settled) => {
          const normalized = normalizeWork(settled);
          if (normalized === null) {
            invalidWork();
            return;
          }
          finishWork(normalized);
        },
        (error: unknown) => {
          finish({
            failed: errorMessage(error),
            retryable: true,
            genHash: requested,
          });
        },
      );
      return;
    }

    const normalized = normalizeWork(result);
    if (normalized === null) {
      invalidWork();
      return;
    }
    finishWork(normalized);
  };
}
