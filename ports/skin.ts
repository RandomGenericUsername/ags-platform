/**
 * `skin.v1` — the pure Skin port (frozen Skin Spec v1).
 *
 * A skin is THREE things and nothing else:
 *
 * 1. a palette/ink mapping — `surface.*` and `ink.*` are palette role
 *    expressions (`@surface_container`, `@on_surface`);
 * 2. paint — the runtime-expanded `skin.css` bytes, applied verbatim;
 * 3. rhythm/density — the numeric or length tokens under `shape`, `type`,
 *    `rhythm` and `layout`.
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
 * The declared token groups. `surface`/`ink` are palette mappings; the rest
 * are shape/typography/rhythm/layout scalars. `structure` and `variant` are
 * deliberately absent (and rejected).
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

//: A palette role reference. The role vocabulary is `palette.v1` plus additive
//: producer roles; the port validates the expression shape, not the live roles.
const ROLE_EXPRESSION = /^@[a-z][a-z0-9_]*$/;

//: `#rgb`, `#rrggbb`, `#rrggbbaa`; palette owns every colour, skins do not.
const HEX_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;

//: Structure/variant are not skin vocabulary.
const FORBIDDEN_NAME = /^(?:structure|variant)(?:-|$)/i;

//: Motion is out of scope for a skin (and would race live CSS swaps).
const TRANSITION_NAME = /^transition(?:-|$)/i;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when `value` is a palette role expression (`@on_surface`). A literal
 * hex is never a role expression.
 */
export function isRoleExpression(value: unknown): value is string {
  return typeof value === "string" && ROLE_EXPRESSION.test(value.trim());
}

/**
 * Validate a palette role expression, rejecting a literal hex and anything
 * that is not `@role`. Returns the trimmed expression.
 */
export function validateRoleExpression(value: unknown, source = "skin"): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SkinParseError(source, null, "expected a palette role expression (@role)");
  }
  const expression = value.trim();
  if (HEX_COLOR.test(expression)) {
    throw new SkinParseError(
      source,
      null,
      `literal hex ${JSON.stringify(expression)} is not allowed; use an @role expression`,
    );
  }
  if (!ROLE_EXPRESSION.test(expression)) {
    throw new SkinParseError(
      source,
      null,
      `invalid role expression ${JSON.stringify(expression)} (expected @role)`,
    );
  }
  return expression;
}

function validateTokenName(source: string, group: SkinTokenGroup, name: string): void {
  if (FORBIDDEN_NAME.test(name)) {
    throw new SkinParseError(
      source,
      `${group}.${name}`,
      "structure/variant tokens are outside Skin Spec v1",
    );
  }
  if (TRANSITION_NAME.test(name)) {
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

function validateTokenValue(
  source: string,
  group: SkinTokenGroup,
  name: string,
  value: unknown,
): SkinTokenValue {
  const path = `${group}.${name}`;
  if (group === "surface" || group === "ink") {
    return validateRoleExpression(value, `${source}:${path}`);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new SkinParseError(source, path, "numeric tokens must be finite and non-negative");
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new SkinParseError(source, path, "token values must be strings or finite numbers");
  }
  const text = value.trim();
  if (text === "") throw new SkinParseError(source, path, "token value is empty");
  if (HEX_COLOR.test(text)) {
    throw new SkinParseError(
      source,
      path,
      `literal hex ${JSON.stringify(text)} is not allowed; palette roles own colours`,
    );
  }
  if (/transition/i.test(text)) {
    throw new SkinParseError(source, path, "transition values are outside Skin Spec v1");
  }
  return text;
}

/**
 * Parse and validate the resolved `skin.json` token map.
 *
 * Accepted shape: one optional `version` (`"1"`, defaulting to `SKIN_VERSION`)
 * plus top-level objects for the declared groups. Unknown groups and
 * `structure`/`variant` are rejected, as are literal hex colours, transition
 * tokens and non-scalar values. Additive token names inside a declared group
 * are kept — the vocabulary is the group set plus the token grammar.
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
