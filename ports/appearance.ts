/**
 * Appearance — the pure consumer port for Generations v3 (contracts `v0.8.0`).
 *
 * One appearance is palette + skin + mode, committed by the runtime as ONE
 * immutable `$XDG_STATE_HOME/dotfiles/generations/<genHash>/` directory behind
 * the single atomically swapped `state/current` pointer. This module owns the
 * policy half of consuming that generation:
 *
 * 1. verify `current/manifest.json` (`version: 3`, `generationHash`, the
 *    appearance targets and `tokensPath`);
 * 2. read the requested generation immutably (preferred
 *    `generations/<genHash>/...`, or a before/after-verified `current`
 *    fallback);
 * 3. parse/validate the resolved `tokens.json` (`version: 2` plus the five
 *    groups `surface`, `state`, `type`, `ink`, `layout`; the v3 generation
 *    wraps the unchanged v2 token vocabulary, and contracts `v0.12.0` adds the
 *    required six-role `surface.window` to that same version);
 * 4. validate the composed `<configDir>.css` (no literal hex, no transition,
 *    no structure/variant);
 * 5. install the composed sheet VERBATIM as ONE provider at USER priority
 *    through an injected replacing sink, exactly once per generation;
 * 6. re-resolve on every watched `current` event and expose a reactive value
 *    accessor plus `appliedHash()`.
 *
 * There is no separate palette apply and no second provider: the composed
 * sheet already contains the palette block followed by the skin CSS.
 *
 * PURE: no `ags`, no `gi://*`, no I/O. The adapter in `../adapters/appearance`
 * supplies XDG paths, GLib reads/watches and the GTK sink.
 */

import { PALETTE_V1_ROLES } from "./palette.ts";
import type { ReadAccessor, ReactiveRuntime } from "./reactive.ts";
import type { CssProviderHandle } from "./theme.ts";

/** The resolved token-document version this contract understands. */
export const APPEARANCE_VERSION = 2;

/** `GTK_STYLE_PROVIDER_PRIORITY_USER` = 800 (installed last wins). */
export const APPEARANCE_PROVIDER_PRIORITY = 800;

/** The five resolved v2 token groups. */
export const APPEARANCE_TOKEN_GROUPS = Object.freeze([
  "surface",
  "state",
  "type",
  "ink",
  "layout",
] as const);

export type AppearanceTokenGroup = (typeof APPEARANCE_TOKEN_GROUPS)[number];

/** Groups the appearance plane forbids: structure stays app-owned. */
export const APPEARANCE_FORBIDDEN_TOKEN_GROUPS = Object.freeze([
  "structure",
  "variant",
] as const);

/** A selected palette mode. */
export type AppearanceMode = "dark" | "light";

/** A resolved token value: a CSS scalar or a finite number. */
export type AppearanceTokenValue = string | number;

/** One flattened mode override map (`surface.panel.radius` -> value). */
export type AppearanceModeValues = Readonly<Record<string, AppearanceTokenValue>>;

/**
 * The parsed v2 token document.
 *
 * `values` stores canonical dotted paths (`surface.panel.radius`,
 * `layout.ags.panel-width`). `mode` carries the optional manifest overrides;
 * a resolved `tokens.json` normally has none because mode is resolved before
 * publication.
 */
export interface AppearanceTokens {
  readonly version: typeof APPEARANCE_VERSION;
  readonly values: Readonly<Record<string, AppearanceTokenValue>>;
  readonly mode: Readonly<Partial<Record<AppearanceMode, AppearanceModeValues>>>;
}

/** A malformed appearance artifact. Names the source and the token path. */
export class AppearanceParseError extends Error {
  readonly source: string;
  readonly path: string | null;

  constructor(source: string, path: string | null, detail: string) {
    super(`${source}${path === null ? "" : `:${path}`}: ${detail}`);
    this.name = "AppearanceParseError";
    this.source = source;
    this.path = path;
  }
}

//: Kebab-case token/app name; no CSS custom-property prefix.
const TOKEN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

//: A palette role reference inside a paint expression.
const ROLE_REFERENCE = /@([a-z][a-z0-9_]*)/g;
const BARE_ROLE = /^[a-z][a-z0-9_]*$/;

//: A CSS expression that is only a role reference or alpha(@role, n).
const ROLE_EXPRESSION = /^@[a-z][a-z0-9_]*$/;
const ALPHA_EXPRESSION =
  /^alpha\(\s*@[a-z][a-z0-9_]*\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?)\s*\)$/;
const COLOR_MIX_EXPRESSION =
  /^color-mix\(\s*in srgb\s*,\s*@[a-z][a-z0-9_]*\s+\d{1,3}%\s*,\s*(?:transparent|@[a-z][a-z0-9_]*)\s*\)$/;
const BLUR_VALUE =
  /^(?:blur\(\d+(?:\.\d+)?px\)(?: saturate\(\d+(?:\.\d+)?\))?|none)$/;

//: Token values reject ANY `#`; palette owns colour atoms.
const HEX_COLOR = /#/;

//: A CSS colour literal only: 3/4/6/8 hex digits with token boundaries. IDs
//: (`window#notifications-window`) and url() fragments are not colours, and a
//: 5/7-digit run is not a CSS hex colour either.
const HEX_COLOR_LITERAL =
  /(?<![\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;

//: url(#fragment) is an SVG reference, never a colour atom.
const CSS_URL_REFERENCE = /url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/gi;

//: Motion is outside the appearance plane and would race a live CSS swap.
const TRANSITION = /transition/i;

//: Structure/order/presence are not appearance vocabulary. The middle form
//: also catches a suffix such as `bg-panel-variant`.
const FORBIDDEN_NAME = /(?:^|[-_])(?:structure|variant|order|presence)(?:[-_]|$)/i;

//: The known palette role names (`palette.v1` plus on_backdrop).
const KNOWN_ROLES = new Set(PALETTE_V1_ROLES);

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(source: string, path: string | null, detail: string): never {
  throw new AppearanceParseError(source, path, detail);
}

function validateString(source: string, path: string, value: unknown): string {
  if (typeof value !== "string") {
    fail(source, path, "expected a string token value");
  }
  const text = value.trim();
  if (text === "") fail(source, path, "token value is empty");
  rejectForbiddenValue(source, path, text);
  return text;
}

function rejectForbiddenValue(source: string, path: string, text: string): void {
  if (HEX_COLOR.test(text)) {
    fail(
      source,
      path,
      `literal hex ${JSON.stringify(text)} is not allowed; palette roles own colours`,
    );
  }
  if (TRANSITION.test(text)) {
    fail(source, path, "transition values are outside the appearance plane");
  }
}

/** Every `@role` in a paint/shadow expression must be a known palette role. */
function validateRoleReferences(source: string, path: string, text: string): void {
  for (const match of text.matchAll(ROLE_REFERENCE)) {
    const role = match[1];
    if (!KNOWN_ROLES.has(role)) {
      fail(source, path, `unknown palette role @${role}`);
    }
  }
}

function validatePaint(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  if (/blur\(/i.test(text)) {
    fail(
      source,
      path,
      "blur( is only legal in surface.panel.blur or surface.window.blur",
    );
  }
  if (/calc\([^)]*%/.test(text)) {
    fail(source, path, "calc() with a percentage is not a legal paint");
  }
  validateRoleReferences(source, path, text);

  const atom =
    text === "transparent" ||
    text === "none" ||
    (BARE_ROLE.test(text) && KNOWN_ROLES.has(text)) ||
    ROLE_EXPRESSION.test(text) ||
    ALPHA_EXPRESSION.test(text) ||
    COLOR_MIX_EXPRESSION.test(text) ||
    /^(?:linear|radial|conic)-gradient\(/.test(text);
  if (!atom) {
    fail(
      source,
      path,
      `invalid paint ${JSON.stringify(text)} (expected transparent, a palette role, @role, alpha(@role, 0..1), color-mix(...) or a gradient)`,
    );
  }
  return text;
}

function validateRoleValue(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  if (text === "transparent") return text;
  if (BARE_ROLE.test(text)) {
    if (!KNOWN_ROLES.has(text)) fail(source, path, `unknown palette role ${text}`);
    return text;
  }
  if (
    ROLE_EXPRESSION.test(text) ||
    ALPHA_EXPRESSION.test(text) ||
    COLOR_MIX_EXPRESSION.test(text)
  ) {
    validateRoleReferences(source, path, text);
    return text;
  }
  fail(
    source,
    path,
    `invalid role value ${JSON.stringify(text)} (expected transparent, a palette role, @role, alpha(@role, 0..1) or color-mix(in srgb, @role <pct>%, transparent|@role))`,
  );
}

function validateBorder(source: string, path: string, value: unknown): string {
  return validateRoleValue(source, path, value);
}

function validateShadow(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  validateRoleReferences(source, path, text);
  return text;
}

function validateBlur(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  if (!BLUR_VALUE.test(text)) {
    fail(
      source,
      path,
      `invalid blur ${JSON.stringify(text)} (expected none or blur(<n>px) with optional saturate(<n>))`,
    );
  }
  return text;
}

function validateFont(source: string, path: string, value: unknown): string {
  return validateString(source, path, value);
}

interface NumberBounds {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
}

function validateNumber(
  source: string,
  path: string,
  value: unknown,
  bounds: NumberBounds = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    const received = typeof value === "string" ? JSON.stringify(value) : String(value);
    fail(source, path, `numeric tokens must be finite JSON numbers (received ${received})`);
  }
  if (bounds.exclusiveMinimum !== undefined && value <= bounds.exclusiveMinimum) {
    fail(source, path, `numeric token must be > ${bounds.exclusiveMinimum}`);
  }
  if (bounds.minimum !== undefined && value < bounds.minimum) {
    fail(source, path, `numeric token must be >= ${bounds.minimum}`);
  }
  if (bounds.maximum !== undefined && value > bounds.maximum) {
    fail(source, path, `numeric token must be <= ${bounds.maximum}`);
  }
  return value;
}

function validateAuto(source: string, path: string, value: unknown): string {
  if (value !== "auto") {
    fail(
      source,
      path,
      `ink-over is derived at runtime; the only legal value is "auto" (received ${JSON.stringify(value)})`,
    );
  }
  return "auto";
}

type TokenKind =
  | "paint"
  | "border"
  | "shadow"
  | "blur"
  | "role"
  | "font"
  | "auto"
  | "nonnegative"
  | "positive"
  | "font-weight"
  | "letter-spacing"
  | "opacity";

type GroupSchema = Readonly<Record<string, Readonly<Record<string, TokenKind>>>>;

const SURFACE_SCHEMA: GroupSchema = Object.freeze({
  // contracts v0.12.0: the required outer/toplevel role. It is a distinct
  // role with its own values; surface.panel is never an alias or fallback.
  window: Object.freeze({
    bg: "paint",
    border: "border",
    "border-width": "nonnegative",
    radius: "nonnegative",
    padding: "nonnegative",
    shadow: "shadow",
    blur: "blur",
    opacity: "opacity",
  }),
  panel: Object.freeze({
    bg: "paint",
    border: "border",
    "border-width": "nonnegative",
    radius: "nonnegative",
    padding: "nonnegative",
    shadow: "shadow",
    blur: "blur",
  }),
  card: Object.freeze({
    bg: "paint",
    border: "border",
    "border-width": "nonnegative",
    radius: "nonnegative",
    padding: "nonnegative",
  }),
  cell: Object.freeze({
    bg: "paint",
    border: "border",
    "border-width": "nonnegative",
    radius: "nonnegative",
    padding: "nonnegative",
    "hover-bg": "paint",
  }),
  control: Object.freeze({
    bg: "paint",
    border: "border",
    "border-width": "nonnegative",
    radius: "nonnegative",
    padding: "nonnegative",
    "font-size": "positive",
    "font-weight": "font-weight",
  }),
  pill: Object.freeze({
    bg: "paint",
    border: "border",
    "border-width": "nonnegative",
    radius: "nonnegative",
    padding: "nonnegative",
    "font-size": "positive",
    "letter-spacing": "letter-spacing",
  }),
});

const STATE_SCHEMA: GroupSchema = Object.freeze({
  hover: Object.freeze({ fill: "role", ink: "role", ring: "role" }),
  selected: Object.freeze({ fill: "role", ink: "role", ring: "role" }),
  focus: Object.freeze({ fill: "role", ink: "role", ring: "role" }),
  disabled: Object.freeze({ fill: "role", ink: "role", ring: "role" }),
});

const TYPE_SCHEMA: Readonly<Record<string, TokenKind>> = Object.freeze({
  "font-family": "font",
  "font-weight": "font-weight",
  "letter-spacing": "letter-spacing",
  "size-caption": "positive",
  "size-meta": "positive",
  "size-body": "positive",
  "size-title": "positive",
  "size-display": "positive",
});

const INK_SCHEMA: Readonly<Record<string, TokenKind>> = Object.freeze({
  ink: "role",
  "ink-dim": "role",
  accent: "role",
  "accent-muted": "role",
  "ink-over": "auto",
});

function validateToken(
  source: string,
  path: string,
  kind: TokenKind,
  value: unknown,
): AppearanceTokenValue {
  switch (kind) {
    case "paint":
      return validatePaint(source, path, value);
    case "border":
      return validateBorder(source, path, value);
    case "shadow":
      return validateShadow(source, path, value);
    case "blur":
      return validateBlur(source, path, value);
    case "role":
      return validateRoleValue(source, path, value);
    case "font":
      return validateFont(source, path, value);
    case "auto":
      return validateAuto(source, path, value);
    case "nonnegative":
      return validateNumber(source, path, value, { minimum: 0 });
    case "positive":
      return validateNumber(source, path, value, { exclusiveMinimum: 0 });
    case "font-weight":
      return validateNumber(source, path, value, { minimum: 1, maximum: 1000 });
    case "letter-spacing":
      return validateNumber(source, path, value, { minimum: -10, maximum: 10 });
    case "opacity":
      // contracts v0.12.0: surface.window.opacity is the only unitless
      // [0, 1] number; it is never a length, percentage or alpha() paint.
      return validateNumber(source, path, value, { minimum: 0, maximum: 1 });
  }
}

function validateLeafMap(
  source: string,
  path: string,
  raw: unknown,
  schema: Readonly<Record<string, TokenKind>>,
  values: Record<string, AppearanceTokenValue>,
): void {
  if (!isPlainObject(raw)) {
    fail(source, path, "expected an object of token: value");
  }
  const expected = Object.keys(schema).sort();
  const actual = Object.keys(raw).sort();
  for (const key of actual) {
    if (FORBIDDEN_NAME.test(key)) {
      fail(
        source,
        `${path}.${key}`,
        "structure/variant tokens are outside the appearance plane",
      );
    }
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      fail(source, `${path}.${key}`, `unknown appearance token ${JSON.stringify(key)}`);
    }
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      fail(source, `${path}.${key}`, "token is required by the v2 vocabulary");
    }
    values[`${path}.${key}`] = validateToken(source, `${path}.${key}`, schema[key], raw[key]);
  }
}

function validateNestedGroup(
  source: string,
  path: string,
  raw: unknown,
  schema: GroupSchema,
  values: Record<string, AppearanceTokenValue>,
): void {
  if (!isPlainObject(raw)) {
    fail(source, path, "expected an object of role/token values");
  }
  const expected = Object.keys(schema).sort();
  const actual = Object.keys(raw).sort();
  for (const key of actual) {
    if (FORBIDDEN_NAME.test(key)) {
      fail(
        source,
        `${path}.${key}`,
        "structure/variant tokens are outside the appearance plane",
      );
    }
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      fail(source, `${path}.${key}`, `unknown appearance token ${JSON.stringify(key)}`);
    }
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      fail(source, `${path}.${key}`, "token is required by the v2 vocabulary");
    }
    const child = raw[key];
    if (!isPlainObject(child)) {
      fail(source, `${path}.${key}`, "expected an object of token: value");
    }
    validateLeafMap(source, `${path}.${key}`, child, schema[key], values);
  }
}

function validateLayout(
  source: string,
  path: string,
  raw: unknown,
  values: Record<string, AppearanceTokenValue>,
): void {
  if (!isPlainObject(raw)) {
    fail(source, path, "expected layout.<app> metric namespaces");
  }
  const apps = Object.keys(raw);
  if (apps.length === 0) fail(source, path, "layout must declare at least one app namespace");
  for (const app of apps) {
    if (FORBIDDEN_NAME.test(app)) {
      fail(source, `${path}.${app}`, "structure/variant tokens are outside the appearance plane");
    }
    if (!TOKEN_NAME.test(app)) {
      fail(source, `${path}.${app}`, "layout app names must be kebab-case");
    }
    const metrics = raw[app];
    if (!isPlainObject(metrics)) {
      fail(source, `${path}.${app}`, "expected an object of metric: number");
    }
    const names = Object.keys(metrics);
    if (names.length === 0) {
      fail(source, `${path}.${app}`, "layout app namespace must declare at least one metric");
    }
    for (const name of names) {
      if (FORBIDDEN_NAME.test(name)) {
        fail(
          source,
          `${path}.${app}.${name}`,
          "structure/variant tokens are outside the appearance plane",
        );
      }
      if (!TOKEN_NAME.test(name)) {
        fail(source, `${path}.${app}.${name}`, "layout metric names must be kebab-case");
      }
      values[`${path}.${app}.${name}`] = validateNumber(
        source,
        `${path}.${app}.${name}`,
        metrics[name],
        { minimum: 0 },
      );
    }
  }
}

function validateGroup(
  source: string,
  group: string,
  raw: unknown,
  values: Record<string, AppearanceTokenValue>,
): void {
  switch (group) {
    case "surface":
      validateNestedGroup(source, group, raw, SURFACE_SCHEMA, values);
      return;
    case "state":
      validateNestedGroup(source, group, raw, STATE_SCHEMA, values);
      return;
    case "type":
      validateLeafMap(source, group, raw, TYPE_SCHEMA, values);
      return;
    case "ink":
      validateLeafMap(source, group, raw, INK_SCHEMA, values);
      return;
    case "layout":
      validateLayout(source, group, raw, values);
      return;
    default:
      fail(source, group, `unknown token group (expected ${APPEARANCE_TOKEN_GROUPS.join(", ")})`);
  }
}

function validateModeOverrides(
  source: string,
  raw: unknown,
): Readonly<Partial<Record<AppearanceMode, AppearanceModeValues>>> {
  if (!isPlainObject(raw)) fail(source, "mode", "expected mode.dark/mode.light overrides");
  const modes: Partial<Record<AppearanceMode, AppearanceModeValues>> = {};
  for (const [mode, override] of Object.entries(raw)) {
    if (mode !== "dark" && mode !== "light") {
      fail(source, `mode.${mode}`, `unknown mode (expected dark or light)`);
    }
    if (!isPlainObject(override)) {
      fail(source, `mode.${mode}`, "expected an object of complete group overrides");
    }
    if (Object.keys(override).length === 0) {
      fail(source, `mode.${mode}`, "mode override must provide at least one group");
    }
    const flattened: Record<string, AppearanceTokenValue> = {};
    for (const [group, groupValue] of Object.entries(override)) {
      if (!(APPEARANCE_TOKEN_GROUPS as readonly string[]).includes(group)) {
        fail(source, `mode.${mode}.${group}`, "unknown token group in mode override");
      }
      validateGroup(source, group, groupValue, flattened);
    }
    modes[mode] = Object.freeze(flattened);
  }
  if (Object.keys(modes).length === 0) {
    fail(source, "mode", "mode must declare dark and/or light");
  }
  return Object.freeze(modes);
}

function applyMode(
  values: Record<string, AppearanceTokenValue>,
  modes: Readonly<Partial<Record<AppearanceMode, AppearanceModeValues>>>,
  mode: AppearanceMode,
): Record<string, AppearanceTokenValue> {
  const override = modes[mode];
  if (override === undefined) return values;
  const resolved = { ...values };
  // A provided group replaces the base group as a whole; omitted groups
  // inherit. There is no deep merge.
  const replaced = new Set(
    Object.keys(override)
      .map((key) => key.slice(0, key.indexOf(".")))
      .filter((group) => group.length > 0),
  );
  for (const group of replaced) {
    for (const key of Object.keys(resolved)) {
      if (key.startsWith(`${group}.`)) delete resolved[key];
    }
  }
  for (const [key, value] of Object.entries(override)) {
    resolved[key] = value;
  }
  return resolved;
}

/**
 * Parse and validate a v2 token document.
 *
 * Accepted root shape: `version: 2` plus the five complete groups
 * `surface`/`state`/`type`/`ink`/`layout`, and an optional `mode` object with
 * `dark`/`light` overrides. `surface` requires the six contracts `v0.12.0`
 * roles `window`/`panel`/`card`/`cell`/`control`/`pill`; `window.opacity` is
 * the only unitless `[0, 1]` number and `window` is never aliased from
 * `panel`. A mode override is a set of complete same-shape groups;
 * `selectedMode` applies the matching override on top of the base groups (the
 * runtime normally publishes an already-resolved `tokens.json` with no `mode`
 * field).
 *
 * Every object level is closed: unknown groups/tokens, structure/variant
 * names, literal hex, `transition`, unit-bearing numeric strings and wrong
 * value kinds are rejected.
 */
export function parseAppearanceJson(
  text: string,
  source = "tokens.json",
  selectedMode?: AppearanceMode,
): AppearanceTokens {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    fail(source, null, `invalid JSON: ${describe(error)}`);
  }
  if (!isPlainObject(raw)) {
    fail(source, null, "expected a JSON object token document");
  }

  let version: typeof APPEARANCE_VERSION | null = null;
  const values: Record<string, AppearanceTokenValue> = {};
  let modes: Readonly<Partial<Record<AppearanceMode, AppearanceModeValues>>> = Object.freeze({});

  for (const [key, groupValue] of Object.entries(raw)) {
    if (key === "version") {
      if (groupValue !== APPEARANCE_VERSION) {
        fail(
          source,
          "version",
          `unsupported appearance version ${JSON.stringify(groupValue)} (expected ${APPEARANCE_VERSION})`,
        );
      }
      version = APPEARANCE_VERSION;
      continue;
    }
    if (FORBIDDEN_NAME.test(key)) {
      fail(source, key, "structure/variant groups are outside the appearance plane");
    }
    if (key === "mode") {
      modes = validateModeOverrides(source, groupValue);
      continue;
    }
    if (!(APPEARANCE_TOKEN_GROUPS as readonly string[]).includes(key)) {
      fail(
        source,
        key,
        `unknown token group (expected version, mode, ${APPEARANCE_TOKEN_GROUPS.join(", ")})`,
      );
    }
    validateGroup(source, key, groupValue, values);
  }

  if (version === null) {
    fail(source, "version", `missing version (expected ${APPEARANCE_VERSION})`);
  }
  for (const group of APPEARANCE_TOKEN_GROUPS) {
    if (!Object.keys(values).some((key) => key.startsWith(`${group}.`))) {
      fail(source, group, "token group is required by the v2 vocabulary");
    }
  }

  const resolved =
    selectedMode === undefined ? values : applyMode(values, modes, selectedMode);

  return Object.freeze({
    version: APPEARANCE_VERSION,
    values: Object.freeze(resolved) as Readonly<Record<string, AppearanceTokenValue>>,
    mode: modes,
  });
}

/**
 * Alias for `parseAppearanceJson` with the artifact name in the call site.
 * The runtime emits `tokens.json`; a manifest-token fixture can use the same
 * parser and pass a selected mode.
 */
export function parseAppearanceTokens(
  text: string,
  source = "tokens.json",
  selectedMode?: AppearanceMode,
): AppearanceTokens {
  return parseAppearanceJson(text, source, selectedMode);
}

const EMPTY_TOKENS: AppearanceTokens = Object.freeze({
  version: APPEARANCE_VERSION,
  values: Object.freeze({}) as Readonly<Record<string, AppearanceTokenValue>>,
  mode: Object.freeze({}),
});

/**
 * Look up a dotted token path. Missing tokens yield `undefined`; a bare name
 * (no dot) is not accepted because v2 layout is namespaced by app.
 */
export function appearanceValue(
  tokens: AppearanceTokens | null | undefined,
  path: string,
  fallback: AppearanceTokenValue,
): AppearanceTokenValue {
  if (tokens === null || tokens === undefined) return fallback;
  if (!Object.prototype.hasOwnProperty.call(tokens.values, path)) return fallback;
  return tokens.values[path];
}

/**
 * Read a token with fallback semantics. A missing token or a type mismatch
 * yields `fallback`; a numeric fallback also accepts a numeric string.
 */
export function readAppearanceToken<T extends AppearanceTokenValue>(
  tokens: AppearanceTokens | null | undefined,
  path: string,
  fallback: T,
): T {
  const value = appearanceValue(tokens, path, fallback);
  if (typeof value === typeof fallback) return value as T;
  if (typeof fallback === "number" && typeof value === "string") {
    const text = value.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(text)) {
      const numeric = Number(text);
      if (Number.isFinite(numeric)) return numeric as T;
    }
  }
  return fallback;
}

/** Everything the reactive accessor needs from an appearance source. */
export interface AppearanceTokenSource {
  tokens(): AppearanceTokens | null;
  subscribe(listener: AppearanceListener): () => void;
}

/**
 * A reactive `value(path, fallback)` accessor bound to an appearance source.
 * The returned cell updates in place when a new generation is applied.
 */
export function createAppearanceValue<T extends AppearanceTokenValue>(
  source: AppearanceTokenSource,
  runtime: ReactiveRuntime,
  path: string,
  fallback: T,
): ReadAccessor<T> {
  const [get, set] = runtime.createState<T>(readAppearanceToken(source.tokens(), path, fallback));
  source.subscribe((tokens) => {
    set(readAppearanceToken(tokens, path, fallback));
  });
  return get;
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Blank every selector prelude (the text before `{`) before the colour scan.
 * Selectors may legitimately contain hex-shaped IDs (`#abc`); only declaration
 * values can carry a literal colour. Property declarations never end in `{`,
 * so the prelude pattern cannot hide one.
 */
function maskCssSelectors(css: string): string {
  return css.replace(
    /(^|[{};])([^{};]*)\{/g,
    (_match, boundary: string, prelude: string) =>
      `${boundary}${" ".repeat(prelude.length)}{`,
  );
}

/**
 * Validate the runtime-composed `<configDir>.css` before it reaches GTK.
 * The adapter applies the bytes VERBATIM; this check only protects the one
 * provider: no literal hex, no transition declarations, no structure/variant
 * custom properties, and no empty sheet.
 */
export function validateAppearanceCss(css: string, source = "appearance.css"): void {
  if (typeof css !== "string" || css.trim() === "") {
    fail(source, null, "appearance CSS is empty");
  }
  // The composed sheet deliberately starts with the runtime palette block:
  // `@define-color <role> <hex>;`. That hex is palette-owned and is the ONE
  // allowed colour atom; every other literal hex is rejected.
  const body = maskCssSelectors(
    stripCssComments(css)
      .replace(/@define-color\s+[A-Za-z0-9_-]+\s+[^;]+;/g, "")
      .replace(CSS_URL_REFERENCE, ""),
  );
  const hex = HEX_COLOR_LITERAL.exec(body);
  if (hex !== null) {
    fail(
      source,
      null,
      `literal hex ${JSON.stringify(hex[0])} is not allowed; palette roles own colours`,
    );
  }
  const transition = /(?:^|[;{\s])transition(?:-[a-z]+)?\s*:/i.exec(body);
  if (transition !== null) {
    fail(source, null, "transition declarations are outside the appearance plane");
  }
  const structural = /--(?:structure|variant)(?:-|:)/i.exec(body);
  if (structural !== null) {
    fail(
      source,
      null,
      `${structural[0]} is a structure/variant token and is outside the appearance plane`,
    );
  }
}

// ---------------------------------------------------------------------------
// Generations v3 (contracts v0.8.0)
// ---------------------------------------------------------------------------

/** The generation manifest version a v3 consumer accepts. */
export const GENERATION_MANIFEST_VERSION = 3;

/** A lowercase 64-character SHA-256 generation identity. */
export const GENERATION_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The generation self-check file, written last inside the generation. */
export const GENERATION_MANIFEST_FILE = "manifest.json";

/** The one token document inside a generation. */
export const GENERATION_TOKENS_PATH = "appearance/tokens.json";

//: One lowercase config-directory segment; the platform carries no app list.
const CONFIG_DIR_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** One `configDir -> composed sheet` target from a generation manifest. */
export interface GenerationAppearanceTarget {
  readonly configDir: string;
  readonly path: string;
}

/** The appearance-relevant part of a v3 generation manifest. */
export interface GenerationManifest {
  readonly version: typeof GENERATION_MANIFEST_VERSION;
  readonly generationHash: string;
  readonly appearance: {
    readonly tokensPath: typeof GENERATION_TOKENS_PATH;
    readonly targets: readonly GenerationAppearanceTarget[];
  };
  /** Present in a complete manifest; validated when present. */
  readonly mode?: AppearanceMode;
}

/** A malformed or misidentified generation manifest. Fails closed. */
export class AppearanceManifestError extends Error {
  readonly source: string;
  readonly path: string | null;

  constructor(source: string, path: string | null, detail: string) {
    super(`${source}${path === null ? "" : `:${path}`}: ${detail}`);
    this.name = "AppearanceManifestError";
    this.source = source;
    this.path = path;
  }
}

function manifestFail(source: string, path: string | null, detail: string): never {
  throw new AppearanceManifestError(source, path, detail);
}

/** True for an exact lowercase 64-hex generation hash. */
export function isGenerationHash(value: unknown): value is string {
  return typeof value === "string" && GENERATION_HASH_PATTERN.test(value);
}

/**
 * Parse and validate the appearance-relevant identity of a v3 generation
 * manifest. A consumer rejects every other version and every target that is
 * not `appearance/<configDir>.css`; it trusts no app list outside the manifest.
 */
export function parseGenerationManifest(
  text: string,
  source = GENERATION_MANIFEST_FILE,
): GenerationManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    manifestFail(source, null, `invalid JSON: ${describe(error)}`);
  }
  if (!isPlainObject(raw)) {
    manifestFail(source, null, "expected a JSON object generation manifest");
  }
  if (raw.version !== GENERATION_MANIFEST_VERSION) {
    manifestFail(
      source,
      "version",
      `unsupported generation manifest version ${JSON.stringify(raw.version)} (expected ${GENERATION_MANIFEST_VERSION})`,
    );
  }
  if (!isGenerationHash(raw.generationHash)) {
    manifestFail(
      source,
      "generationHash",
      "expected a lowercase 64-character SHA-256 generation hash",
    );
  }
  if (!isPlainObject(raw.appearance)) {
    manifestFail(source, "appearance", "expected an appearance object");
  }
  if (raw.appearance.tokensPath !== GENERATION_TOKENS_PATH) {
    manifestFail(
      source,
      "appearance.tokensPath",
      `expected ${JSON.stringify(GENERATION_TOKENS_PATH)}`,
    );
  }
  if (!Array.isArray(raw.appearance.targets) || raw.appearance.targets.length === 0) {
    manifestFail(source, "appearance.targets", "expected at least one target");
  }

  const targets: GenerationAppearanceTarget[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.appearance.targets.entries()) {
    const path = `appearance.targets[${index}]`;
    if (!isPlainObject(value)) {
      manifestFail(source, path, "expected a { configDir, path } object");
    }
    if (typeof value.configDir !== "string" || !CONFIG_DIR_PATTERN.test(value.configDir)) {
      manifestFail(source, `${path}.configDir`, "expected one lowercase config-directory segment");
    }
    if (seen.has(value.configDir)) {
      manifestFail(source, `${path}.configDir`, `duplicate configDir ${JSON.stringify(value.configDir)}`);
    }
    const expectedPath = `appearance/${value.configDir}.css`;
    if (value.path !== expectedPath) {
      manifestFail(
        source,
        `${path}.path`,
        `expected ${JSON.stringify(expectedPath)} (the sheet for ${value.configDir})`,
      );
    }
    seen.add(value.configDir);
    targets.push(Object.freeze({ configDir: value.configDir, path: expectedPath }));
  }

  let mode: AppearanceMode | undefined;
  if (raw.mode !== undefined) {
    if (raw.mode !== "dark" && raw.mode !== "light") {
      manifestFail(source, "mode", "expected dark or light");
    }
    mode = raw.mode;
  }
  if (isPlainObject(raw.skin) && raw.skin.mode !== undefined && mode !== undefined) {
    if (raw.skin.mode !== mode) {
      manifestFail(source, "skin.mode", "must equal the manifest mode");
    }
  }
  if (isPlainObject(raw.intent) && raw.intent.mode !== undefined && mode !== undefined) {
    if (raw.intent.mode !== mode) {
      manifestFail(source, "intent.mode", "must equal the manifest mode");
    }
  }

  return Object.freeze({
    version: GENERATION_MANIFEST_VERSION,
    generationHash: raw.generationHash,
    appearance: Object.freeze({
      tokensPath: GENERATION_TOKENS_PATH,
      targets: Object.freeze(targets),
    }),
    ...(mode === undefined ? {} : { mode }),
  });
}

/** The target for one app config dir; a missing target fails closed. */
export function generationAppearanceTarget(
  manifest: GenerationManifest,
  configDir: string,
  source = GENERATION_MANIFEST_FILE,
): GenerationAppearanceTarget {
  const target = manifest.appearance.targets.find((entry) => entry.configDir === configDir);
  if (target === undefined) {
    manifestFail(
      source,
      "appearance.targets",
      `generation ${manifest.generationHash} does not publish ${JSON.stringify(configDir)}`,
    );
  }
  return target;
}

/**
 * The state-plane paths one app-scoped Appearance uses. There is no
 * `$XDG_CONFIG_HOME` read path: the runtime publishes only under
 * `$XDG_STATE_HOME/dotfiles`.
 */
export interface AppearancePaths {
  /** `$XDG_STATE_HOME/dotfiles/current` — the ONE watched hop. */
  readonly currentPath: string;
  /** `current/manifest.json`. */
  readonly manifestPath: string;
  /** `$XDG_STATE_HOME/dotfiles/generations`. */
  readonly generationsPath: string;
  /** `current/appearance` (read through `current`, never watched). */
  readonly currentAppearancePath: string;
  /** `current/appearance/tokens.json` (current fallback read). */
  readonly tokensPath: string;
  /** `current/appearance/<configDir>.css` (current fallback read). */
  readonly appearanceCssPath: string;
}

/** Resolve the v3 state-plane paths for one app config dir. */
export function resolveAppearancePaths(
  configDir: string,
  stateHome: string,
): AppearancePaths {
  const stateRoot = `${stateHome}/dotfiles`;
  const currentPath = `${stateRoot}/current`;
  const currentAppearancePath = `${currentPath}/appearance`;
  return {
    currentPath,
    manifestPath: `${currentPath}/${GENERATION_MANIFEST_FILE}`,
    generationsPath: `${stateRoot}/generations`,
    currentAppearancePath,
    tokensPath: `${currentAppearancePath}/tokens.json`,
    appearanceCssPath: `${currentAppearancePath}/${configDir}.css`,
  };
}

/** A generation-bound apply outcome. Every outcome names the requested hash. */
export type AppearanceApplyResult =
  | { readonly status: "applied"; readonly genHash: string }
  | { readonly status: "deferred"; readonly reason: string; readonly genHash: string }
  | {
      readonly status: "failed";
      readonly reason: string;
      readonly retryable: boolean;
      readonly genHash: string;
    };

function appliedResult(genHash: string): AppearanceApplyResult {
  return Object.freeze({ status: "applied", genHash });
}

function deferredResult(genHash: string, reason: string): AppearanceApplyResult {
  return Object.freeze({ status: "deferred", reason, genHash });
}

function failedResult(
  genHash: string,
  reason: string,
  retryable: boolean,
): AppearanceApplyResult {
  return Object.freeze({ status: "failed", reason, retryable, genHash });
}

/** The provider-owned half of an appearance sink (priority is supplied). */
export interface AppearanceCssHost {
  add(css: string, priority: number): CssProviderHandle;
  remove(provider: CssProviderHandle): void;
}

/** The one thing the pure core needs from the display. */
export interface AppearanceCssSink {
  apply(css: string): void;
}

/**
 * An appearance `CssSink` that keeps exactly ONE provider per app.
 *
 * Each apply adds the next provider at USER priority (800) BEFORE removing the
 * previous one, so no frame is skinless and the appearance provider is the
 * last-installed provider. Only a handle this sink added is ever removed.
 */
export function createReplacingAppearanceCssSink(
  host: AppearanceCssHost,
): AppearanceCssSink {
  let current: CssProviderHandle | null = null;
  return {
    apply(css: string): void {
      const next = host.add(css, APPEARANCE_PROVIDER_PRIORITY);
      const previous = current;
      current = next;
      if (previous !== null) host.remove(previous);
    },
  };
}

/** A change listener; called only after a new generation is installed. */
export type AppearanceListener = (tokens: AppearanceTokens) => void;

/** Everything the pure Appearance core needs from its host. */
export interface AppearanceOptions {
  /** The app's AGS config directory; input, never a platform app list. */
  configDir: string;
  /** The v3 state-plane paths resolved for `configDir`. */
  paths: AppearancePaths;
  /** The single replacing appearance provider sink. */
  sink: AppearanceCssSink;
  /** The reactive runtime used by `value(path, fallback)`. */
  runtime: ReactiveRuntime;
  /** Read a UTF-8 artifact; `null` means absent. */
  readFile(path: string): string | null;
  /** Watch the single `current` hop; the core starts at most one. */
  watchFile(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

/** The public Appearance consumer. */
export interface Appearance {
  /**
   * Apply a named generation. With no argument, resolve the generation from
   * the committed `current` pointer. A missing `current` returns `null`; every
   * named-generation outcome carries the requested hash.
   */
  apply(genHash?: string): AppearanceApplyResult | null;
  /**
   * Apply exactly this generation. If `current` points elsewhere or the
   * generation is absent, apply nothing and answer deferred/failed with the
   * requested hash.
   */
  applyGeneration(genHash: string): AppearanceApplyResult;
  /** The exact generation currently installed by this instance, or null. */
  appliedHash(): string | null;
  /** The last successfully loaded token map (empty before the first load). */
  tokens(): AppearanceTokens;
  /**
   * Subscribe to generation changes. ONE watcher on the `current` pointer is
   * shared by every listener and stopped by the last unsubscribe. The listener
   * runs only after the new sheet has been installed.
   */
  subscribe(listener: AppearanceListener): () => void;
  /** Reactive accessor for one dotted token path (callable + `.peek()`). */
  value<T extends AppearanceTokenValue>(path: string, fallback: T): ReadAccessor<T>;
}

/**
 * Build an Appearance over the runtime's one committed generation pointer.
 *
 * Failure policy:
 * - a missing current manifest/generation is a no-op; the previous provider
 *   and token map stay;
 * - a requested generation that is not `current`, or is absent, is never
 *   applied: the result is `deferred` with the requested hash;
 * - a malformed manifest/artifact is a retryable failure and keeps the
 *   previous provider;
 * - identical generation hash is installed once, even across a filesystem
 *   event burst;
 * - the app stylesheet and GTK theme are never touched.
 */
export function createAppearance(options: AppearanceOptions): Appearance {
  const { configDir, paths, sink, runtime, readFile, watchFile } = options;
  const report =
    options.onError ??
    ((error: unknown): void => {
      console.error(`appearance: ${describe(error)}`);
    });

  let loaded: AppearanceTokens | null = null;
  let applied: string | null = null;
  let stopWatching: (() => void) | null = null;
  const listeners = new Set<AppearanceListener>();

  function notify(tokens: AppearanceTokens): void {
    for (const listener of [...listeners]) {
      try {
        listener(tokens);
      } catch (error) {
        report(error);
      }
    }
  }

  /** Read and verify the committed manifest; throws only for malformed JSON. */
  function readCurrentManifest(): GenerationManifest | null {
    const text = readFile(paths.manifestPath);
    if (text === null) return null;
    return parseGenerationManifest(text, paths.manifestPath);
  }

  /**
   * Resolve the requested generation, then read and install it.
   *
   * `current/manifest.json` is checked before and after the artifact read.
   * Even when the immutable `generations/<genHash>/...` path exists, a pointer
   * that no longer names the request means the request is stale: answer
   * deferred and install nothing. The direct path is preferred for the read,
   * so a generation tree cannot be stitched from two different commits.
   */
  function resolveAndInstall(genHash: string): AppearanceApplyResult {
    if (!isGenerationHash(genHash)) {
      return failedResult(genHash, "invalid generation hash", false);
    }

    let before: GenerationManifest | null;
    try {
      before = readCurrentManifest();
    } catch (error) {
      return failedResult(genHash, describe(error), true);
    }
    if (before === null) {
      return deferredResult(genHash, "current generation is missing");
    }
    if (before.generationHash !== genHash) {
      return deferredResult(
        genHash,
        `current generation moved to ${before.generationHash}`,
      );
    }

    // Prefer the immutable generation directory. A missing direct manifest
    // falls back to reading through `current` (verified again below).
    const generationDir = `${paths.generationsPath}/${genHash}`;
    let direct: GenerationManifest | null = null;
    const directText = readFile(`${generationDir}/${GENERATION_MANIFEST_FILE}`);
    if (directText !== null) {
      try {
        direct = parseGenerationManifest(
          directText,
          `${generationDir}/${GENERATION_MANIFEST_FILE}`,
        );
      } catch (error) {
        return failedResult(genHash, describe(error), true);
      }
      if (direct.generationHash !== genHash) {
        return failedResult(
          genHash,
          `generation directory ${genHash} contains manifest ${direct.generationHash}`,
          true,
        );
      }
    }

    const manifest = direct ?? before;
    const manifestSource = direct === null ? paths.manifestPath : generationDir;
    let target: GenerationAppearanceTarget;
    try {
      target = generationAppearanceTarget(manifest, configDir, manifestSource);
    } catch (error) {
      return failedResult(genHash, describe(error), false);
    }

    const base = direct === null ? paths.currentPath : generationDir;
    const cssPath = `${base}/${target.path}`;
    const tokensPath = `${base}/${manifest.appearance.tokensPath}`;
    const css = readFile(cssPath);
    const tokenText = readFile(tokensPath);
    if (css === null || tokenText === null) {
      return deferredResult(
        genHash,
        direct === null
          ? "current generation artifacts are missing"
          : "requested generation is missing",
      );
    }

    // Re-verify the commit pointer after reading. If it moved, the requested
    // generation is stale even though its immutable files still exist.
    let after: GenerationManifest | null;
    try {
      after = readCurrentManifest();
    } catch (error) {
      return failedResult(genHash, describe(error), true);
    }
    if (after === null || after.generationHash !== genHash) {
      return deferredResult(genHash, "current generation moved during read");
    }

    let tokens: AppearanceTokens;
    try {
      tokens = parseAppearanceJson(tokenText, tokensPath);
      validateAppearanceCss(css, cssPath);
    } catch (error) {
      return failedResult(genHash, describe(error), true);
    }

    // One apply per generation. A repeated request for the same committed
    // generation still answers applied without installing a second provider.
    if (applied === genHash && loaded !== null) {
      return appliedResult(genHash);
    }

    // The composed sheet already contains palette + skin; applying it verbatim
    // is the whole appearance apply.
    sink.apply(css);
    loaded = tokens;
    applied = genHash;
    notify(tokens);
    return appliedResult(genHash);
  }

  function applyGeneration(genHash: string): AppearanceApplyResult {
    try {
      return resolveAndInstall(genHash);
    } catch (error) {
      // Never throw from a Gio signal callback: the previous provider stays.
      report(error);
      return failedResult(genHash, describe(error), true);
    }
  }

  function apply(genHash?: string): AppearanceApplyResult | null {
    if (genHash !== undefined) return applyGeneration(genHash);

    // No explicit request: converge to the committed pointer. A commit can
    // land between reading `current` and re-reading it inside
    // applyGeneration; re-resolve the new pointer a bounded number of times.
    // This is event-driven convergence, not polling.
    let last: AppearanceApplyResult | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const current = readCurrentManifest();
        if (current === null) return null;
        last = applyGeneration(current.generationHash);
      } catch (error) {
        report(error);
        return null;
      }
      if (
        last.status !== "deferred" ||
        !last.reason.startsWith("current generation moved")
      ) {
        return last;
      }
    }
    return last;
  }

  function reload(): void {
    apply();
  }

  const source: AppearanceTokenSource = {
    tokens: () => loaded,
    subscribe: (listener) => subscribe(listener),
  };

  function subscribe(listener: AppearanceListener): () => void {
    listeners.add(listener);
    if (stopWatching === null) {
      stopWatching = watchFile(paths.currentPath, reload);
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
  }

  return {
    apply,
    applyGeneration,
    appliedHash(): string | null {
      return applied;
    },

    tokens(): AppearanceTokens {
      return loaded ?? EMPTY_TOKENS;
    },

    subscribe,

    value<T extends AppearanceTokenValue>(path: string, fallback: T): ReadAccessor<T> {
      return createAppearanceValue(source, runtime, path, fallback);
    },
  };
}
