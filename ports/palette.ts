/**
 * `palette.v1` — the typed role vocabulary behind the Theme provider (REQ-013
 * Phase A; runtime contract REQ-006, `dotfiles-runtime`).
 *
 * The runtime emits `current/colors.yaml` as a flat, machine-generated map of
 * role -> `#hex` scalars, plus a legacy `colors:` list kept for older tools.
 * This module parses exactly that production shape into a typed `Palette`, so
 * consumers stop reading the artifact themselves and stop guessing its shape.
 * Parsing is deliberately dependency-free (no YAML package): the file is
 * generated, and the accepted subset is pinned by a test.
 *
 * ## CSS convention (for the Phase B app migrations)
 *
 * Every declared role is projected by the platform-owned provider as ONE GTK
 * named color, using the role name verbatim:
 *
 * ```css
 * @define-color primary #b9c3ff;
 * @define-color on_backdrop #e3e1e9;
 * ```
 *
 * App CSS therefore references the role with the same `@` sigil GTK uses for
 * any named color:
 *
 * ```css
 * .card { color: @on_surface; background: @surface_container; }
 * .floating { color: @on_backdrop; }
 * ```
 *
 * The helper `paletteCssVariable(role)` returns that reference (`@primary`)
 * for code that builds CSS strings. Role names are the vocabulary names — no
 * `color_`/`color00..15` prefix is added; the legacy `@color_*` aliases keep
 * working unchanged through Phase A (they come from `colors.css`).
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

/** The declared role vocabulary version (`palette.v1`; REQ-006). */
export const PALETTE_VERSION = "1";

/**
 * The `palette.v1` declaration: the 50 theme-producer Material roles in
 * declaration order, then the produced `on_backdrop` role.
 *
 * Source: `dotfiles-runtime/src/runtime/domain/palette_vocabulary.py`
 * (`PALETTE_VOCABULARY_V1`, theme-producer v0.5.0 REQ-022). Additive producer
 * roles (for example `accent`, `warning`, `cursor`) are allowed and simply
 * appear in `Palette.roles`; they do not change the vocabulary version.
 */
export const PALETTE_V1_ROLES: readonly string[] = Object.freeze([
  "background",
  "error",
  "error_container",
  "inverse_on_surface",
  "inverse_primary",
  "inverse_surface",
  "on_background",
  "on_error",
  "on_error_container",
  "on_primary",
  "on_primary_container",
  "on_primary_fixed",
  "on_primary_fixed_variant",
  "on_secondary",
  "on_secondary_container",
  "on_secondary_fixed",
  "on_secondary_fixed_variant",
  "on_surface",
  "on_surface_variant",
  "on_tertiary",
  "on_tertiary_container",
  "on_tertiary_fixed",
  "on_tertiary_fixed_variant",
  "outline",
  "outline_variant",
  "primary",
  "primary_container",
  "primary_fixed",
  "primary_fixed_dim",
  "scrim",
  "secondary",
  "secondary_container",
  "secondary_fixed",
  "secondary_fixed_dim",
  "shadow",
  "source_color",
  "surface",
  "surface_bright",
  "surface_container",
  "surface_container_high",
  "surface_container_highest",
  "surface_container_low",
  "surface_container_lowest",
  "surface_dim",
  "surface_tint",
  "surface_variant",
  "tertiary",
  "tertiary_container",
  "tertiary_fixed",
  "tertiary_fixed_dim",
  "on_backdrop",
]);

/**
 * The typed palette the Theme port exposes. `roles` is frozen and holds every
 * top-level role declared by the runtime, including `on_backdrop` and any
 * additive producer role.
 */
export interface Palette {
  readonly version: string;
  readonly roles: Readonly<Record<string, string>>;
}

/**
 * A malformed palette artifact. Carries the source path and the 1-based line
 * where the parser gave up, so a broken dispatch names the file and line
 * instead of failing somewhere inside GTK.
 */
export class PaletteParseError extends Error {
  readonly source: string;
  readonly line: number | null;

  constructor(source: string, line: number | null, detail: string) {
    super(`${source}${line === null ? "" : `:${line}`}: ${detail}`);
    this.name = "PaletteParseError";
    this.source = source;
    this.line = line;
  }
}

//: Top-level YAML scalar key. Mirrors the runtime parser's accepted subset.
const TOP_KEY = /^([A-Za-z0-9_][A-Za-z0-9_.-]*):(?:[ \t]+(.*?))?[ \t]*$/;

//: Accepted role values: #rgb, #rrggbb, #rrggbbaa (REQ-006 conformance).
const HEX_VALUE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

//: The legacy sequence key; its indented list is not a role map.
const LEGACY_LIST_KEY = "colors";

//: Optional additive version scalar (the current producer omits it).
const VERSION_KEY = "version";

/**
 * Return the scalar after `key:`: unquoted token, or the contents of a single-
 * or double-quoted string. `null` means "not a usable scalar" (a comment, a
 * block scalar, a collection, or an unterminated quote).
 */
function scalarValue(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  if (text.startsWith("#")) {
    // `#121318` is a legal unquoted value in the machine-generated file even
    // though YAML itself would read it as a comment. Accept it only when the
    // token is a valid hex color; `# a comment` stays a comment.
    const token = text.split(/[ \t]/, 1)[0];
    return HEX_VALUE.test(token) ? token : null;
  }
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, 1);
    if (end === -1) return null;
    return text.slice(1, end);
  }
  if ("|>[{&*!@`".includes(quote)) return null;
  const token = text.split(/[ \t]/, 1)[0];
  return token === "" ? null : token;
}

/**
 * Parse a runtime `colors.yaml` into a `Palette`.
 *
 * Accepted shape (the machine-generated production shape):
 * - top-level `role: "#rrggbb"` scalars, quoted or unquoted, with optional
 *   inline comments;
 * - `# ...` comments and blank lines anywhere;
 * - the legacy `colors:` sequence block, which is ignored entirely;
 * - an optional top-level `version:` scalar (defaults to `PALETTE_VERSION`).
 *
 * Everything else fails with `PaletteParseError`: indented lines outside the
 * legacy block, a role without a scalar (nested maps/blocks), an invalid hex
 * value, a duplicate role, or a file with no roles. Fail-closed is deliberate:
 * a silently half-read palette would render a wrong theme.
 */
export function parsePaletteYaml(text: string, source = "colors.yaml"): Palette {
  const normalized = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const lines = normalized.split(/\r?\n/);
  const entries = new Map<string, string>();
  let version = PALETTE_VERSION;
  let versionSeen = false;
  let inLegacyBlock = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (line.trim() === "") continue;
    if (/^[ \t]/.test(line)) {
      if (inLegacyBlock) continue;
      throw new PaletteParseError(
        source,
        lineNumber,
        "unexpected indented line (only top-level role scalars are supported)",
      );
    }
    if (line.startsWith("#")) continue;

    const match = TOP_KEY.exec(line);
    if (match === null) {
      throw new PaletteParseError(
        source,
        lineNumber,
        `not a top-level "key: value" line: ${JSON.stringify(line)}`,
      );
    }

    const key = match[1];
    const raw = match[2] ?? "";

    if (key === LEGACY_LIST_KEY) {
      // Machine-generated legacy alias list; never a role source.
      inLegacyBlock = true;
      continue;
    }
    inLegacyBlock = false;

    const value = scalarValue(raw);
    if (value === null) {
      throw new PaletteParseError(
        source,
        lineNumber,
        `"${key}" has no readable scalar value (nested blocks, collections and unterminated quotes are not supported)`,
      );
    }

    if (key === VERSION_KEY) {
      if (versionSeen) {
        throw new PaletteParseError(source, lineNumber, "duplicate version key");
      }
      versionSeen = true;
      version = value;
      continue;
    }

    if (entries.has(key)) {
      throw new PaletteParseError(
        source,
        lineNumber,
        `duplicate role "${key}"`,
      );
    }
    if (!HEX_VALUE.test(value)) {
      throw new PaletteParseError(
        source,
        lineNumber,
        `role "${key}" has invalid value ${JSON.stringify(value)} (expected #rgb, #rrggbb or #rrggbbaa)`,
      );
    }
    entries.set(key, value);
  }

  if (entries.size === 0) {
    throw new PaletteParseError(
      source,
      null,
      "no palette roles found (expected top-level role: \"#rrggbb\" scalars)",
    );
  }

  // Frozen for the same reason the port returns Readonly: a consumer must not
  // mutate the provider's palette behind the provider's back.
  return Object.freeze({
    version,
    roles: Object.freeze(Object.fromEntries(entries)) as Readonly<
      Record<string, string>
    >,
  });
}

/**
 * Render the provider-owned CSS projection: one `@define-color <role> <hex>;`
 * per declared role, in declaration order.
 */
export function renderPaletteCss(palette: Palette): string {
  const safeVersion = palette.version.replace(/[^A-Za-z0-9._-]/g, "") || "?";
  const lines = [`/* palette.v${safeVersion} role tokens (theme provider) */`];
  for (const [role, value] of Object.entries(palette.roles)) {
    lines.push(`@define-color ${role} ${value};`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The CSS reference for a role, for code that builds stylesheet text:
 * `paletteCssVariable("primary") === "@primary"`.
 */
export function paletteCssVariable(role: string): string {
  return `@${role}`;
}

/**
 * Declared `palette.v1` roles absent from `palette`. Additive roles are not a
 * violation; this helper exists for diagnostics and the Phase B migration
 * gate, which may want to fail closed on a renamed/removed role.
 */
export function missingPaletteRoles(palette: Palette): string[] {
  return PALETTE_V1_ROLES.filter((role) => !(role in palette.roles));
}
