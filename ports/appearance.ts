/**
 * `appearance.v2` — the pure Appearance port (contracts `v0.7.0`).
 *
 * One appearance is palette + skin + mode, published by the runtime as ONE
 * immutable generation behind the single atomically repointed hop
 * `$XDG_STATE_HOME/dotfiles/current/appearance`. This module owns the policy
 * half of consuming that generation:
 *
 * 1. parse/validate the resolved `tokens.json` (`version: 2` plus the five
 *    groups `surface`, `state`, `type`, `ink`, `layout`; an optional manifest
 *    `mode.dark`/`mode.light` override may be resolved for a selected mode);
 * 2. validate the composed `<configDir>.css` (no literal hex, no transition,
 *    no structure/variant);
 * 3. install the composed sheet VERBATIM as ONE provider at USER priority
 *    through an injected replacing sink;
 * 4. re-read the generation on every watched-pointer event, skip re-applying
 *    identical content (a convenience link creation is not a new generation),
 *    and expose a reactive value accessor.
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

//: Palette owns colour atoms; a literal hex is never legal in an appearance.
const HEX_COLOR = /#/;

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
    fail(source, path, "blur( is only legal in surface.panel.blur");
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
  | "letter-spacing";

type GroupSchema = Readonly<Record<string, Readonly<Record<string, TokenKind>>>>;

const SURFACE_SCHEMA: GroupSchema = Object.freeze({
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
 * `dark`/`light` overrides. A mode override is a set of complete same-shape
 * groups; `selectedMode` applies the matching override on top of the base
 * groups (the runtime normally publishes an already-resolved `tokens.json`
 * with no `mode` field).
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
  const body = stripCssComments(css).replace(
    /@define-color\s+[A-Za-z0-9_-]+\s+[^;]+;/g,
    "",
  );
  if (HEX_COLOR.test(body)) {
    fail(source, null, "literal hex is not allowed; palette roles own colours");
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
  /** The single watched hop: `$XDG_STATE_HOME/dotfiles/current/appearance`. */
  watchPath: string;
  /** Composed CSS through the stable consumer link. */
  appearanceCssPath: string;
  /** Resolved token document through the current generation pointer. */
  tokensPath: string;
  /** The single replacing appearance provider sink. */
  sink: AppearanceCssSink;
  /** The reactive runtime used by `value(path, fallback)`. */
  runtime: ReactiveRuntime;
  /** Read a UTF-8 artifact; `null` means absent. */
  readFile(path: string): string | null;
  /** Watch the single appearance pointer; the core starts at most one. */
  watchFile(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

/** The public Appearance consumer. */
export interface Appearance {
  /**
   * Read/compose/apply the current generation. Missing artifacts are a no-op;
   * identical content is coalesced so one generation is installed once.
   */
  apply(): void;
  /** The last successfully loaded token map (empty before the first load). */
  tokens(): AppearanceTokens;
  /**
   * Subscribe to appearance changes. ONE watcher on the state pointer is
   * shared by every listener and stopped by the last unsubscribe. The listener
   * runs only after the new sheet has been installed.
   */
  subscribe(listener: AppearanceListener): () => void;
  /** Reactive accessor for one dotted token path (callable + `.peek()`). */
  value<T extends AppearanceTokenValue>(path: string, fallback: T): ReadAccessor<T>;
}

/**
 * Build an Appearance over the runtime's one pointer.
 *
 * Failure policy:
 * - a missing composed CSS or token document is a no-op; the previous
 *   provider and token map stay;
 * - a malformed artifact reports through `onError` and keeps the previous
 *   provider;
 * - identical CSS + token content is not applied twice (the runtime's atomic
 *   repoint plus the convenience link creation is one generation);
 * - the app stylesheet and GTK theme are never touched.
 */
export function createAppearance(options: AppearanceOptions): Appearance {
  const { watchPath, appearanceCssPath, tokensPath, sink, runtime, readFile, watchFile } =
    options;
  const report =
    options.onError ??
    ((error: unknown): void => {
      console.error(`appearance: ${describe(error)}`);
    });

  let loaded: AppearanceTokens | null = null;
  let fingerprint: string | null = null;
  let stopWatching: (() => void) | null = null;
  const listeners = new Set<AppearanceListener>();

  /**
   * Read + validate + install. Returns `null` for a missing artifact (no-op)
   * and `{ changed: false }` when the same generation is already installed.
   * Throws for malformed artifacts; the caller reports and keeps the previous
   * provider.
   */
  function install(): { tokens: AppearanceTokens; changed: boolean } | null {
    const css = readFile(appearanceCssPath);
    const tokenText = readFile(tokensPath);
    if (css === null || tokenText === null) return null;

    const tokens = parseAppearanceJson(tokenText, tokensPath);
    validateAppearanceCss(css, appearanceCssPath);

    // Content is the generation signature: the runtime never rewrites a
    // published generation, so equal bytes mean the same appearance. This
    // coalesces the repoint event and the convenience-link creation.
    const nextFingerprint = `${css}\u0000${tokenText}`;
    if (fingerprint === nextFingerprint && loaded !== null) {
      return { tokens: loaded, changed: false };
    }

    // The composed sheet already contains palette + skin; applying it
    // verbatim is the whole appearance apply.
    sink.apply(css);
    loaded = tokens;
    fingerprint = nextFingerprint;
    return { tokens, changed: true };
  }

  function notify(tokens: AppearanceTokens): void {
    for (const listener of [...listeners]) {
      try {
        listener(tokens);
      } catch (error) {
        report(error);
      }
    }
  }

  function reload(): void {
    try {
      const next = install();
      if (next === null || !next.changed) return;
      notify(next.tokens);
    } catch (error) {
      // Never throw from a Gio signal callback: the previous provider stays.
      report(error);
    }
  }

  const source: AppearanceTokenSource = {
    tokens: () => loaded,
    subscribe: (listener) => subscribe(listener),
  };

  function subscribe(listener: AppearanceListener): () => void {
    listeners.add(listener);
    if (stopWatching === null) {
      stopWatching = watchFile(watchPath, reload);
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
    apply(): void {
      try {
        const next = install();
        if (next !== null && next.changed) notify(next.tokens);
      } catch (error) {
        report(error);
      }
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
