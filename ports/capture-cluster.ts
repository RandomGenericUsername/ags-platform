/**
 * The bar → capture recording-cluster request contract (SPIKE-003 option B).
 *
 * The bar owns the slot and asks the capture process to draw the recording
 * cluster at that slot. AGS's request transport carries exactly one JSON string
 * per request; this module is the one place that shapes and validates it.
 *
 * OWNERSHIP
 * - `v`, `command`, `seq`, `compact` and `anchor` are bar-owned.
 * - `observed` is only a bootstrap/logging hint; capture's `capture.state` is
 *   authoritative once it has delivered its first snapshot.
 * - `labels` is an optional host override; capture owns the defaults.
 *
 * COORDINATES
 * `anchor.x/y/width/height` are monitor-local LOGICAL pixels. `monitorX/Y` and
 * `monitorWidth/Height` are only a fallback identity for resolving a monitor;
 * no scale factor is applied to the slot. `scale` is diagnostic.
 *
 * PURE: no `ags/*`, no `gi://*`, no I/O.
 */

/** The request handler's argv[0]. */
export const CAPTURE_CLUSTER_COMMAND = "capture-cluster";

/** The only in-band payload version this contract understands. */
export const CAPTURE_CLUSTER_VERSION = 1;

export type ClusterPhase = "recording" | "paused" | "idle";
export type ClusterCommand = "show" | "update" | "hide" | "popover-close";
export type ClusterEdge = "top" | "bottom";

export interface ClusterAnchor {
  /** GDK connector name; null when the host cannot report one. */
  connector: string | null;
  /** Monitor geometry in the compositor's global logical space. */
  monitorX: number;
  monitorY: number;
  monitorWidth: number;
  monitorHeight: number;
  /** Diagnostics only. Slot coordinates are already logical. */
  scale: number;
  /** Slot rectangle, monitor-local logical pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Popover direction: top bars open below, bottom bars open above. */
  edge: ClusterEdge;
}

export interface ClusterObserved {
  phase: ClusterPhase;
  jobId?: string | null;
  elapsedSeconds?: number;
}

export interface ClusterLabels {
  recording: string;
  paused: string;
  pause: string;
  resume: string;
  stop: string;
}

export interface ClusterRequest {
  v: typeof CAPTURE_CLUSTER_VERSION;
  command: ClusterCommand;
  /** Per-bar-instance monotonic. Capture keeps the highest sequence per slot. */
  seq: number;
  compact: boolean;
  /** Required for show/update; optional for hide/popover-close. */
  anchor?: ClusterAnchor;
  observed?: ClusterObserved;
  labels?: Partial<ClusterLabels>;
}

export type ClusterResponse =
  | { ok: true }
  | { ok: false; error: string; retryable: boolean };

/** A validation failure, with a detail for logs but no extra response fields. */
export interface ClusterValidationFailure {
  ok: false;
  error: "bad-request" | "unsupported-version";
  detail: string;
}

export type ClusterValidation =
  | { ok: true; request: ClusterRequest }
  | ClusterValidationFailure;

const COMMANDS = new Set<ClusterCommand>([
  "show",
  "update",
  "hide",
  "popover-close",
]);
const PHASES = new Set<ClusterPhase>(["recording", "paused", "idle"]);
const EDGES = new Set<ClusterEdge>(["top", "bottom"]);
const LABEL_KEYS = [
  "recording",
  "paused",
  "pause",
  "resume",
  "stop",
] as const;
const REQUEST_FIELDS = new Set([
  "v",
  "command",
  "seq",
  "compact",
  "anchor",
  "observed",
  "labels",
]);
const ANCHOR_FIELDS = new Set([
  "connector",
  "monitorX",
  "monitorY",
  "monitorWidth",
  "monitorHeight",
  "scale",
  "x",
  "y",
  "width",
  "height",
  "edge",
]);
const OBSERVED_FIELDS = new Set(["phase", "jobId", "elapsedSeconds"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}

function bad(detail: string): ClusterValidationFailure {
  return { ok: false, error: "bad-request", detail };
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): string | null {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return `${path}.${key} is not a known field`;
  }
  return null;
}

function validateAnchor(value: unknown): ClusterValidationFailure | ClusterAnchor {
  if (!isRecord(value)) return bad("anchor must be an object");
  const unknown = unknownFields(value, ANCHOR_FIELDS, "anchor");
  if (unknown !== null) return bad(unknown);

  if (value.connector !== null && typeof value.connector !== "string") {
    return bad("anchor.connector must be a string or null");
  }
  if (typeof value.connector === "string" && value.connector === "") {
    return bad("anchor.connector must not be empty");
  }
  if (!finite(value.monitorX)) return bad("anchor.monitorX must be finite");
  if (!finite(value.monitorY)) return bad("anchor.monitorY must be finite");
  if (!positive(value.monitorWidth)) {
    return bad("anchor.monitorWidth must be positive");
  }
  if (!positive(value.monitorHeight)) {
    return bad("anchor.monitorHeight must be positive");
  }
  if (!positive(value.scale)) return bad("anchor.scale must be positive");
  if (!finite(value.x)) return bad("anchor.x must be finite");
  if (!finite(value.y)) return bad("anchor.y must be finite");
  if (!positive(value.width)) return bad("anchor.width must be positive");
  if (!positive(value.height)) return bad("anchor.height must be positive");
  if (typeof value.edge !== "string" || !EDGES.has(value.edge as ClusterEdge)) {
    return bad('anchor.edge must be "top" or "bottom"');
  }

  return {
    connector: value.connector as string | null,
    monitorX: value.monitorX,
    monitorY: value.monitorY,
    monitorWidth: value.monitorWidth,
    monitorHeight: value.monitorHeight,
    scale: value.scale,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    edge: value.edge as ClusterEdge,
  };
}

function validateObserved(value: unknown): ClusterValidationFailure | ClusterObserved {
  if (!isRecord(value)) return bad("observed must be an object");
  const unknown = unknownFields(value, OBSERVED_FIELDS, "observed");
  if (unknown !== null) return bad(unknown);
  if (typeof value.phase !== "string" || !PHASES.has(value.phase as ClusterPhase)) {
    return bad('observed.phase must be "recording", "paused" or "idle"');
  }
  if (
    value.jobId !== undefined &&
    value.jobId !== null &&
    typeof value.jobId !== "string"
  ) {
    return bad("observed.jobId must be a string or null");
  }
  if (
    value.elapsedSeconds !== undefined &&
    !nonNegative(value.elapsedSeconds)
  ) {
    return bad("observed.elapsedSeconds must be a non-negative number");
  }
  return {
    phase: value.phase as ClusterPhase,
    ...(value.jobId !== undefined ? { jobId: value.jobId as string | null } : {}),
    ...(value.elapsedSeconds !== undefined
      ? { elapsedSeconds: value.elapsedSeconds as number }
      : {}),
  };
}

function validateLabels(value: unknown): ClusterValidationFailure | Partial<ClusterLabels> {
  if (!isRecord(value)) return bad("labels must be an object");
  const allowed = new Set<string>(LABEL_KEYS);
  const unknown = unknownFields(value, allowed, "labels");
  if (unknown !== null) return bad(unknown);
  const labels: Partial<ClusterLabels> = {};
  for (const key of LABEL_KEYS) {
    const label = value[key];
    if (label === undefined) continue;
    if (typeof label !== "string" || label === "") {
      return bad(`labels.${key} must be a non-empty string`);
    }
    labels[key] = label;
  }
  return labels;
}

/**
 * Validate an already-parsed request.
 *
 * Unknown fields are rejected so a typo cannot silently become "use the
 * default". A future field requires a version bump, which is exactly the
 * `unsupported-version` path this contract already has.
 */
export function validateClusterRequest(value: unknown): ClusterValidation {
  if (!isRecord(value)) return bad("the request must be a JSON object");

  if (value.v !== CAPTURE_CLUSTER_VERSION) {
    return {
      ok: false,
      error: "unsupported-version",
      detail: `v must be ${CAPTURE_CLUSTER_VERSION}`,
    };
  }

  const unknown = unknownFields(value, REQUEST_FIELDS, "$");
  if (unknown !== null) return bad(unknown);

  if (
    typeof value.command !== "string" ||
    !COMMANDS.has(value.command as ClusterCommand)
  ) {
    return bad("command must be show, update, hide or popover-close");
  }
  if (
    typeof value.seq !== "number" ||
    !Number.isSafeInteger(value.seq) ||
    value.seq < 0
  ) {
    return bad("seq must be a non-negative safe integer");
  }
  if (typeof value.compact !== "boolean") {
    return bad("compact must be a boolean");
  }

  const command = value.command as ClusterCommand;
  let anchor: ClusterAnchor | undefined;
  if (value.anchor !== undefined) {
    const parsed = validateAnchor(value.anchor);
    if ("ok" in parsed) return parsed;
    anchor = parsed;
  }
  if ((command === "show" || command === "update") && anchor === undefined) {
    return bad(`${command} requires an anchor`);
  }

  let observed: ClusterObserved | undefined;
  if (value.observed !== undefined) {
    const parsed = validateObserved(value.observed);
    if ("ok" in parsed) return parsed;
    observed = parsed;
  }

  let labels: Partial<ClusterLabels> | undefined;
  if (value.labels !== undefined) {
    const parsed = validateLabels(value.labels);
    if ("ok" in parsed) return parsed;
    labels = parsed;
  }

  return {
    ok: true,
    request: {
      v: CAPTURE_CLUSTER_VERSION,
      command,
      seq: value.seq,
      compact: value.compact,
      ...(anchor !== undefined ? { anchor } : {}),
      ...(observed !== undefined ? { observed } : {}),
      ...(labels !== undefined ? { labels } : {}),
    },
  };
}

/** Parse the single JSON argv argument and validate it. Bad JSON is an issue. */
export function parseClusterRequest(text: string | null | undefined): ClusterValidation {
  if (typeof text !== "string" || text.trim() === "") {
    return bad("missing JSON request");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return bad(`invalid JSON: ${message}`);
  }
  return validateClusterRequest(value);
}

/** Encode the one response string the AGS request handler must return. */
export function encodeClusterResponse(response: ClusterResponse): string {
  return JSON.stringify(response);
}
