/**
 * `skin.v1` — the pure Skin port (frozen Skin Spec v1, vocabulary v0.6.0).
 *
 * A skin is THREE things and nothing else:
 *
 * 1. a palette/ink mapping — `surface.*` is paint over palette roles and
 *    `ink.*` is a role expression (`@surface_container`,
 *    `alpha(@on_surface, 0.62)`);
 * 2. paint — the runtime-expanded `skin.css` bytes, applied verbatim;
 * 3. rhythm/density — the numeric tokens under `shape`, `type`, `rhythm` and
 *    `layout`, plus the one literal `rhythm.cell-pad` length pair.
 *
 * Values are validated per token, not by group: a token's kind comes from the
 * canonical `contracts` v0.6.0 vocabulary (13 numbers, 3 paints, a shadow, a
 * blur, 3 ink expressions, `ink-over: auto`, `cell-pad` and `font-family`).
 * The vocabulary is closed: unknown token names are rejected, as are structure
 * and variant names, literal hex, and `transition`.
 *
 * It carries NO structure or variant tokens. The runtime expands a skin; the
 * platform never does. This module only parses/validates the resolved token
 * map and composes the expanded CSS with the runtime palette block.
 *
 * ## Artifacts (owned by the adapter, not this pure module)
 *
 * - `$XDG_CONFIG_HOME/ags/skin.css` — runtime-expanded CSS.
 * - `$XDG_STATE_HOME/dotfiles/current/skin.json` — resolved token map:
 *   top-level `shape`, `surface`, `ink`, `type`, `rhythm`, `layout` groups.
 *
 * ## One provider, USER priority
 *
 * A skin is installed as ONE `Gtk.CssProvider` whose sheet is the runtime
 * palette block (`colors.css` + `palette.v1` role defines) FOLLOWED BY the
 * expanded skin CSS. That ordering is what makes `@on_surface` and friends
 * resolve instead of painting near-black.
 *
 * The provider MUST be added at `GTK_STYLE_PROVIDER_PRIORITY_USER` (800).
 * AGS installs the app stylesheet from `app.start({ css })` at USER; a
 * skin at APPLICATION priority silently loses every conflict. Because USER is
 * also the app's priority, the skin has to be the LAST-installed provider on
 * every swap: add the new provider BEFORE removing the previous one.
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

import {
  parsePaletteYaml,
  type Palette,
} from "./palette.ts";
import type { ReadAccessor, ReactiveRuntime } from "./reactive.ts";
import {
  composeThemeCss,
  type CssProviderHandle,
} from "./theme.ts";

/** The token-map version this contract understands. */
export const SKIN_VERSION = "1";

/**
 * The declared token groups. `surface` carries paint (3 role expressions plus
 * `shadow` and `blur`); `ink` carries 3 role expressions plus the derived
 * `ink-over: auto`. The remaining groups are numbers, the `cell-pad` length
 * pair and the font family.
 *
 * The per-token vocabulary (contracts v0.6.0) is closed:
 *
 * - `shape`: `radius-panel`, `radius-card`, `radius-cell`, `radius-pill`,
 *   `border-w`, `hairline-w` (numbers);
 * - `surface`: `bg-panel`, `bg-card`, `border` (paint), `shadow`, `blur`;
 * - `ink`: `ink`, `ink-dim`, `accent` (role expressions), `ink-over` (auto);
 * - `type`: `font-family` (string), `title-size`, `text-size` (numbers);
 * - `rhythm`: `gap` (number), `cell-pad` (`"<n>px <n>px"`);
 * - `layout`: `panel-width`, `bt-list-spacing`, `bar-row-height`, `chip-min`
 *   (numbers).
 *
 * `structure` and `variant` are deliberately absent (and rejected), and any
 * token name outside this vocabulary is rejected, not treated as additive.
 */
export const SKIN_TOKEN_GROUPS = Object.freeze([
  "shape",
  "surface",
  "ink",
  "type",
  "rhythm",
  "layout",
] as const);

export type SkinTokenGroup = (typeof SKIN_TOKEN_GROUPS)[number];

/** Groups the frozen spec forbids: a skin never restructures a widget. */
export const SKIN_FORBIDDEN_TOKEN_GROUPS = Object.freeze([
  "structure",
  "variant",
] as const);

/**
 * `GTK_STYLE_PROVIDER_PRIORITY_USER` = 800. AGS installs the app stylesheet at
 * this same priority, so the skin provider must be the most recently added
 * provider. Lower (APPLICATION = 600) silently loses.
 */
export const SKIN_PROVIDER_PRIORITY = 800;

/** A resolved token value: a CSS scalar or a finite number. */
export type SkinTokenValue = string | number;

/**
 * The resolved token map. Values are stored under canonical `group.name`
 * keys so `layout.panel-width` and the bare `panel-width` can both be looked
 * up without ambiguity in the map itself.
 */
export interface SkinTokens {
  readonly version: string;
  readonly values: Readonly<Record<string, SkinTokenValue>>;
}

/** A malformed skin artifact. Names the artifact and the offending token path. */
export class SkinParseError extends Error {
  readonly source: string;
  readonly path: string | null;

  constructor(source: string, path: string | null, detail: string) {
    super(`${source}${path === null ? "" : `:${path}`}: ${detail}`);
    this.name = "SkinParseError";
    this.source = source;
    this.path = path;
  }
}

//: Kebab-case token name; no CSS custom-property prefix.
const TOKEN_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

//: A palette role name. The role vocabulary is `palette.v1` plus additive
//: producer roles; the port validates the expression shape, not the live roles.
const ROLE_NAME = "[a-z][a-z0-9_]*";
const ROLE_REFERENCE = new RegExp(`^@${ROLE_NAME}$`);
const ALPHA_EXPRESSION = new RegExp(
  `^alpha\\(\\s*@${ROLE_NAME}\\s*,\\s*(?:0(?:\\.\\d+)?|1(?:\\.0+)?)\\s*\\)$`,
);
const COLOR_MIX_EXPRESSION = new RegExp(
  `^color-mix\\(\\s*in srgb\\s*,\\s*@${ROLE_NAME}\\s+(\\d{1,3})%\\s*,\\s*(?:transparent|@${ROLE_NAME})\\s*\\)$`,
);
const BLUR_VALUE = /^(?:blur\(\d+(?:\.\d+)?px\)(?: saturate\(\d+(?:\.\d+)?\))?|none)$/;
const CELL_PAD = /^\d+px \d+px$/;

//: `#rgb`, `#rrggbb`, `#rrggbbaa`; palette owns every colour, skins do not.
const HEX_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

//: Structure/variant/order/presence are not skin vocabulary. The middle form
//: also catches a suffix such as `bg-panel-variant`.
const FORBIDDEN_NAME = /(?:^|[-_])(?:structure|variant|order|presence)(?:[-_]|$)/i;

//: Motion is out of scope for a skin (and would race live CSS swaps). Any
//: occurrence is rejected, in a token name or a token value.
const TRANSITION = /transition/i;

/**
 * The canonical per-token kinds from contracts v0.6.0. The vocabulary is
 * closed: a token absent from this map is rejected instead of accepted as an
 * additive scalar.
 */
type SkinTokenKind =
  | "number"
  | "paint"
  | "shadow"
  | "blur"
  | "ink"
  | "auto"
  | "cell-pad"
  | "font";

const TOKEN_KINDS: Readonly<Record<string, SkinTokenKind>> = Object.freeze({
  "shape.radius-panel": "number",
  "shape.radius-card": "number",
  "shape.radius-cell": "number",
  "shape.radius-pill": "number",
  "shape.border-w": "number",
  "shape.hairline-w": "number",

  "surface.bg-panel": "paint",
  "surface.bg-card": "paint",
  "surface.border": "paint",
  "surface.shadow": "shadow",
  "surface.blur": "blur",

  "ink.ink": "ink",
  "ink.ink-dim": "ink",
  "ink.accent": "ink",
  "ink.ink-over": "auto",

  "type.font-family": "font",
  "type.title-size": "number",
  "type.text-size": "number",

  "rhythm.gap": "number",
  "rhythm.cell-pad": "cell-pad",

  "layout.panel-width": "number",
  "layout.bt-list-spacing": "number",
  "layout.bar-row-height": "number",
  "layout.chip-min": "number",
});

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAlphaExpression(value: string): boolean {
  return ALPHA_EXPRESSION.test(value);
}

function isColorMixExpression(value: string): boolean {
  const match = COLOR_MIX_EXPRESSION.exec(value);
  return match !== null && Number(match[1]) <= 100;
}

/**
 * True when `value` is a palette role expression: a bare `@on_surface` or an
 * `alpha(@on_surface, 0.62)`. A literal hex is never a role expression.
 */
export function isRoleExpression(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const expression = value.trim();
  return ROLE_REFERENCE.test(expression) || isAlphaExpression(expression);
}

function rejectForbiddenValue(source: string, path: string, text: string): void {
  if (HEX_COLOR.test(text)) {
    throw new SkinParseError(
      source,
      path,
      `literal hex ${JSON.stringify(text)} is not allowed; palette roles own colours`,
    );
  }
  if (TRANSITION.test(text)) {
    throw new SkinParseError(source, path, "transition values are outside Skin Spec v1");
  }
}

function validateRoleValue(source: string, path: string | null, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SkinParseError(
      source,
      path,
      "expected a palette role expression (@role or alpha(@role, 0..1))",
    );
  }
  const expression = value.trim();
  if (HEX_COLOR.test(expression)) {
    throw new SkinParseError(
      source,
      path,
      `literal hex ${JSON.stringify(expression)} is not allowed; use an @role expression`,
    );
  }
  if (!isRoleExpression(expression)) {
    throw new SkinParseError(
      source,
      path,
      `invalid role expression ${JSON.stringify(expression)} (expected @role or alpha(@role, 0..1))`,
    );
  }
  return expression;
}

/**
 * Validate a palette role expression, rejecting a literal hex and anything
 * that is neither `@role` nor `alpha(@role, 0..1)`. Returns the trimmed
 * expression.
 */
export function validateRoleExpression(value: unknown, source = "skin"): string {
  return validateRoleValue(source, null, value);
}

function validateTokenName(source: string, group: SkinTokenGroup, name: string): void {
  if (FORBIDDEN_NAME.test(name)) {
    throw new SkinParseError(
      source,
      `${group}.${name}`,
      "structure/variant tokens are outside Skin Spec v1",
    );
  }
  if (TRANSITION.test(name)) {
    throw new SkinParseError(
      source,
      `${group}.${name}`,
      "transition tokens are outside Skin Spec v1",
    );
  }
  if (!TOKEN_NAME.test(name)) {
    throw new SkinParseError(
      source,
      `${group}.${name}`,
      "token names must be kebab-case (a-z, 0-9, '-')",
    );
  }
}

function validateNumber(source: string, path: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    const received = typeof value === "string" ? JSON.stringify(value) : String(value);
    throw new SkinParseError(
      source,
      path,
      `numeric tokens must be unitless, finite and non-negative (received ${received})`,
    );
  }
  return value;
}

function validateString(source: string, path: string, value: unknown): string {
  if (typeof value !== "string") {
    throw new SkinParseError(source, path, "expected a string token value");
  }
  const text = value.trim();
  if (text === "") throw new SkinParseError(source, path, "token value is empty");
  return text;
}

function validatePaint(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  rejectForbiddenValue(source, path, text);
  if (
    text === "transparent" ||
    ROLE_REFERENCE.test(text) ||
    isAlphaExpression(text) ||
    isColorMixExpression(text)
  ) {
    return text;
  }
  throw new SkinParseError(
    source,
    path,
    `invalid paint ${JSON.stringify(text)} (expected transparent, @role, alpha(@role, 0..1) or color-mix(in srgb, @role <pct>%, transparent|@role))`,
  );
}

function validateShadow(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  rejectForbiddenValue(source, path, text);
  return text;
}

function validateBlur(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  rejectForbiddenValue(source, path, text);
  if (!BLUR_VALUE.test(text)) {
    throw new SkinParseError(
      source,
      path,
      `invalid blur ${JSON.stringify(text)} (expected none or blur(<n>px) with optional saturate(<n>))`,
    );
  }
  return text;
}

function validateInk(source: string, path: string, value: unknown): string {
  return validateRoleValue(source, path, value);
}

function validateAuto(source: string, path: string, value: unknown): string {
  if (value !== "auto") {
    throw new SkinParseError(
      source,
      path,
      `ink-over is derived at runtime; the only legal value is "auto" (received ${JSON.stringify(value)})`,
    );
  }
  return "auto";
}

function validateCellPad(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  rejectForbiddenValue(source, path, text);
  if (!CELL_PAD.test(text)) {
    throw new SkinParseError(
      source,
      path,
      `invalid cell-pad ${JSON.stringify(text)} (expected exactly "<n>px <n>px")`,
    );
  }
  return text;
}

function validateFont(source: string, path: string, value: unknown): string {
  const text = validateString(source, path, value);
  rejectForbiddenValue(source, path, text);
  return text;
}

function validateTokenValue(
  source: string,
  group: SkinTokenGroup,
  name: string,
  value: unknown,
): SkinTokenValue {
  const path = `${group}.${name}`;
  const kind = TOKEN_KINDS[path];
  if (kind === undefined) {
    throw new SkinParseError(
      source,
      path,
      `unknown ${group} token ${JSON.stringify(name)} (not in the frozen v0.6.0 vocabulary)`,
    );
  }
  switch (kind) {
    case "number":
      return validateNumber(source, path, value);
    case "paint":
      return validatePaint(source, path, value);
    case "shadow":
      return validateShadow(source, path, value);
    case "blur":
      return validateBlur(source, path, value);
    case "ink":
      return validateInk(source, path, value);
    case "auto":
      return validateAuto(source, path, value);
    case "cell-pad":
      return validateCellPad(source, path, value);
    case "font":
      return validateFont(source, path, value);
  }
}

/**
 * Parse and validate the resolved `skin.json` token map.
 *
 * Accepted shape: one optional `version` (`"1"`, defaulting to `SKIN_VERSION`)
 * plus top-level objects for the declared groups. Unknown groups,
 * `structure`/`variant` names and unknown token names are rejected, as are
 * literal hex colours, `transition`, non-scalar values and wrong value kinds.
 *
 * Each token is validated by its canonical kind (contracts v0.6.0): numeric
 * tokens are unitless finite non-negative JSON numbers (never `"12px"`), the
 * three surface paints follow the role grammar, `shadow`/`blur`/`cell-pad`/
 * `font-family` use their own grammars, the three ink expressions are role
 * expressions and `ink-over` is exactly `"auto"`.
 */
export function parseSkinJson(text: string, source = "skin.json"): SkinTokens {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new SkinParseError(source, null, `invalid JSON: ${describe(error)}`);
  }
  if (!isPlainObject(raw)) {
    throw new SkinParseError(source, null, "expected a JSON object token map");
  }

  let version = SKIN_VERSION;
  const values: Record<string, SkinTokenValue> = {};

  for (const [key, groupValue] of Object.entries(raw)) {
    if (key === "version") {
      if (groupValue !== SKIN_VERSION && groupValue !== Number(SKIN_VERSION)) {
        throw new SkinParseError(
          source,
          "version",
          `unsupported skin version ${JSON.stringify(groupValue)} (expected ${JSON.stringify(SKIN_VERSION)})`,
        );
      }
      version = SKIN_VERSION;
      continue;
    }
    if (FORBIDDEN_NAME.test(key)) {
      throw new SkinParseError(
        source,
        key,
        "structure/variant groups are outside Skin Spec v1",
      );
    }
    if (!(SKIN_TOKEN_GROUPS as readonly string[]).includes(key)) {
      throw new SkinParseError(
        source,
        key,
        `unknown token group (expected ${SKIN_TOKEN_GROUPS.join(", ")})`,
      );
    }
    const group = key as SkinTokenGroup;
    if (!isPlainObject(groupValue)) {
      throw new SkinParseError(source, group, "expected an object of token: value");
    }
    for (const [name, tokenValue] of Object.entries(groupValue)) {
      validateTokenName(source, group, name);
      values[`${group}.${name}`] = validateTokenValue(source, group, name, tokenValue);
    }
  }

  if (Object.keys(values).length === 0) {
    throw new SkinParseError(source, null, "no skin tokens found");
  }

  return Object.freeze({
    version,
    values: Object.freeze(values) as Readonly<Record<string, SkinTokenValue>>,
  });
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Validate runtime-expanded skin CSS against the frozen contract: no literal
 * hex colours (palette roles own colour), no `transition` declarations and no
 * structure/variant custom properties. The adapter applies the bytes verbatim;
 * this check only protects the composed provider.
 */
export function validateSkinCss(css: string, source = "skin.css"): void {
  if (typeof css !== "string" || css.trim() === "") {
    throw new SkinParseError(source, null, "skin CSS is empty");
  }
  const body = stripCssComments(css);
  const hex = HEX_COLOR.exec(body);
  if (hex !== null) {
    throw new SkinParseError(
      source,
      null,
      `literal hex ${JSON.stringify(hex[0])} is not allowed; palette roles own colours`,
    );
  }
  const transition = /(?:^|[;{\s])transition(?:-[a-z]+)?\s*:/i.exec(body);
  if (transition !== null) {
    throw new SkinParseError(source, null, "transition declarations are outside Skin Spec v1");
  }
  const structural = /--(?:structure|variant)(?:-|:)/i.exec(body);
  if (structural !== null) {
    throw new SkinParseError(
      source,
      null,
      `${structural[0]} is a structure/variant token and is outside Skin Spec v1`,
    );
  }
}

/**
 * Compose the one provider's sheet: the runtime palette block first, then the
 * expanded skin CSS. Keeping the palette prefix is what makes `@role`
 * references in the skin resolve instead of painting near-black.
 */
export function composeSkinCss(paletteCss: string, skinCss: string): string {
  if (skinCss === "") return paletteCss;
  if (paletteCss === "") return skinCss;
  const separator = paletteCss.endsWith("\n") ? "" : "\n";
  return `${paletteCss}${separator}${skinCss}`;
}

/**
 * The provider-owned half of a skin sink. The host must apply `priority`
 * verbatim (the adapter passes `SKIN_PROVIDER_PRIORITY` = USER = 800).
 */
export interface SkinCssHost {
  add(css: string, priority: number): CssProviderHandle;
  remove(provider: CssProviderHandle): void;
}

/** The one thing the pure core needs from the display. */
export interface SkinCssSink {
  apply(css: string): void;
}

/**
 * A skin `CssSink` that keeps exactly ONE skin provider on the display.
 *
 * Each apply adds the next provider at USER priority BEFORE removing the
 * previous one. The skin is therefore the last-installed provider on every
 * swap, and there is never a frame with no skin/palette sheet. Only a handle
 * this sink added is ever removed: the app stylesheet and GTK theme are never
 * touched.
 */
export function createReplacingSkinCssSink(host: SkinCssHost): SkinCssSink {
  let current: CssProviderHandle | null = null;
  return {
    apply(css: string): void {
      const next = host.add(css, SKIN_PROVIDER_PRIORITY);
      const previous = current;
      // Track the new provider before removing the old one: if removal fails,
      // the sink still owns what it just installed.
      current = next;
      if (previous !== null) host.remove(previous);
    },
  };
}

/** A skin change listener; called only after the new sheet is installed. */
export type SkinListener = (tokens: SkinTokens) => void;

/** Everything the token accessor needs from a skin source. */
export interface SkinTokenSource {
  tokens(): SkinTokens | null;
  subscribe(listener: SkinListener): () => void;
}

/**
 * Look up a token. Exact `group.name` wins; a bare `panel-width` searches the
 * declared group order (layout tokens are the common bare case).
 */
export function skinTokenValue(
  tokens: SkinTokens | null | undefined,
  key: string,
): SkinTokenValue | undefined {
  if (tokens === null || tokens === undefined) return undefined;
  if (Object.prototype.hasOwnProperty.call(tokens.values, key)) {
    return tokens.values[key];
  }
  if (key.includes(".")) return undefined;
  for (const group of SKIN_TOKEN_GROUPS) {
    const value = tokens.values[`${group}.${key}`];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Read a token with fallback semantics. Missing tokens and type mismatches
 * yield `fallback`; a numeric fallback also accepts a numeric string.
 */
export function readSkinToken<T extends SkinTokenValue>(
  tokens: SkinTokens | null | undefined,
  key: string,
  fallback: T,
): T {
  const value = skinTokenValue(tokens, key);
  if (value === undefined) return fallback;
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

/**
 * An accessor-compatible `skinValue(key, fallback)`: the adapter binds this to
 * the AGS reactive runtime; a fake runtime binds it in tests. Reads update in
 * place when the skin reloads, so widgets do not remount.
 */
export function createSkinValue<T extends SkinTokenValue>(
  source: SkinTokenSource,
  runtime: ReactiveRuntime,
  key: string,
  fallback: T,
): ReadAccessor<T> {
  const [get, set] = runtime.createState<T>(readSkinToken(source.tokens(), key, fallback));
  source.subscribe((tokens) => {
    set(readSkinToken(tokens, key, fallback));
  });
  return get;
}

/** Everything the pure Skin core needs from its host. */
export interface SkinOptions {
  /** Runtime-expanded CSS pointer (`$XDG_CONFIG_HOME/ags/skin.css`). */
  skinCssPath: string;
  /** Resolved token-map pointer (`$XDG_STATE_HOME/dotfiles/current/skin.json`). */
  skinJsonPath: string;
  /** The stable legacy palette sheet (`colors.css`). */
  legacyCssPath: string;
  /** The typed palette artifact (`colors.yaml`). */
  palettePath: string;
  /** The single replacing skin provider sink. */
  sink: SkinCssSink;
  /** Read a UTF-8 artifact; `null` means the artifact is absent. */
  readFile(path: string): string | null;
  /** Watch one path; the core starts one watcher per skin artifact. */
  watchFile(path: string, onChange: () => void): () => void;
  /** Report a non-fatal load/parse/apply failure (default: `console.error`). */
  onError?(error: unknown): void;
}

/** The public Skin port. */
export interface Skin {
  /** Read/compose/apply the current artifacts. Missing artifacts are a no-op. */
  apply(): void;
  /** The last successfully loaded token map (empty before the first load). */
  tokens(): SkinTokens;
  /**
   * Subscribe to skin changes. ONE watcher per artifact is shared by every
   * listener and stopped by the last unsubscribe. The listener runs only after
   * the new composed sheet has been installed.
   */
  subscribe(listener: SkinListener): () => void;
}

const EMPTY_TOKENS: SkinTokens = Object.freeze({
  version: SKIN_VERSION,
  values: Object.freeze({}) as Readonly<Record<string, SkinTokenValue>>,
});

/**
 * Build a Skin over the runtime artifacts.
 *
 * Failure policy:
 * - any missing artifact (skin.css, skin.json, colors.css, colors.yaml) is a
 *   no-op: the previous provider, if any, stays and `apply()` changes nothing;
 * - a malformed skin (JSON, contract violation, empty/invalid CSS) reports
 *   through `onError` and keeps the previous provider;
 * - the app stylesheet and GTK theme are never touched.
 */
export function createSkin(options: SkinOptions): Skin {
  const {
    skinCssPath,
    skinJsonPath,
    legacyCssPath,
    palettePath,
    sink,
    readFile,
    watchFile,
  } = options;
  const report =
    options.onError ??
    ((error: unknown): void => {
      console.error(`skin: ${describe(error)}`);
    });

  let loaded: SkinTokens | null = null;
  let stops: Array<() => void> | null = null;
  const listeners = new Set<SkinListener>();

  function readOptional(path: string): string | null {
    return readFile(path);
  }

  /**
   * Read + validate + compose + install. Returns `null` for a missing artifact
   * (no-op). Throws for malformed artifacts; the caller reports and leaves the
   * previous provider installed.
   */
  function install(): SkinTokens | null {
    const skinCss = readOptional(skinCssPath);
    const skinJson = readOptional(skinJsonPath);
    if (skinCss === null || skinJson === null) return null;

    const tokens = parseSkinJson(skinJson, skinJsonPath);
    validateSkinCss(skinCss, skinCssPath);

    // The composed provider always carries the runtime role block: without it,
    // @role references in skin.css paint near-black.
    const legacyCss = readOptional(legacyCssPath);
    const paletteText = readOptional(palettePath);
    if (legacyCss === null || paletteText === null) {
      throw new SkinParseError(
        skinJsonPath,
        null,
        "palette artifacts are missing; refusing to install a skin without roles",
      );
    }
    const palette: Palette = parsePaletteYaml(paletteText, palettePath);
    const composed = composeSkinCss(composeThemeCss(legacyCss, palette), skinCss);
    sink.apply(composed);
    loaded = tokens;
    return tokens;
  }

  function notify(tokens: SkinTokens): void {
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
      if (next === null) return;
      notify(next);
    } catch (error) {
      // Never throw from a Gio signal callback: that aborts unrelated signal
      // handling. The previous provider stays installed.
      report(error);
    }
  }

  return {
    apply(): void {
      try {
        const next = install();
        if (next !== null) notify(next);
      } catch (error) {
        report(error);
      }
    },

    tokens(): SkinTokens {
      return loaded ?? EMPTY_TOKENS;
    },

    subscribe(listener: SkinListener): () => void {
      listeners.add(listener);
      if (stops === null) {
        stops = [
          watchFile(skinCssPath, reload),
          watchFile(skinJsonPath, reload),
        ];
      }
      let active = true;
      return (): void => {
        if (!active) return;
        active = false;
        if (!listeners.delete(listener)) return;
        if (listeners.size === 0 && stops !== null) {
          const release = stops;
          stops = null;
          for (const stop of release) stop();
        }
      };
    },
  };
}
