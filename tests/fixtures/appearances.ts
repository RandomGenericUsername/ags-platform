/**
 * Hard-coded resolved v2 appearance token documents for the stock test runner.
 *
 * Source: contracts `v0.12.0`
 * `tests/fixtures/appearance-contract/appearance-json/glass.valid.json`, plus
 * the additional `layout.<app>` namespaces the platform must read per
 * configDir. contracts `v0.12.0` keeps the token-model version at `2` and adds
 * the required `surface.window` role with exactly eight tokens. No cross-repo
 * import: the stock runner has no access to the contracts checkout, so the
 * document is copied and reviewed here.
 */

export const GLASS_APPEARANCE: Record<string, unknown> = {
  version: 2,
  surface: {
    window: {
      bg: "alpha(@surface, 0.94)",
      border: "@primary",
      "border-width": 1.5,
      radius: 12,
      padding: 11,
      shadow: "none",
      blur: "none",
      opacity: 0.94,
    },
    panel: {
      bg: "linear-gradient(180deg, alpha(@surface, 0.72), alpha(@surface_container, 0.82))",
      border: "color-mix(in srgb, @outline 60%, transparent)",
      "border-width": 1.5,
      radius: 18,
      padding: 11,
      shadow: "0 8px 24px alpha(@shadow, 0.35)",
      blur: "blur(18px) saturate(1.2)",
    },
    card: {
      bg: "alpha(@surface_container_high, 0.55)",
      border: "alpha(@on_surface, 0.1)",
      "border-width": 1,
      radius: 14,
      padding: 10,
    },
    cell: {
      bg: "transparent",
      border: "transparent",
      "border-width": 0,
      radius: 10,
      padding: 8,
      "hover-bg": "alpha(@on_surface, 0.08)",
    },
    control: {
      bg: "alpha(@surface_container, 0.45)",
      border: "alpha(@on_surface, 0.26)",
      "border-width": 1,
      radius: 8,
      padding: 4,
      "font-size": 12,
      "font-weight": 600,
    },
    pill: {
      bg: "alpha(@on_surface, 0.12)",
      border: "alpha(@on_surface, 0.14)",
      "border-width": 1,
      radius: 20,
      padding: 2,
      "font-size": 9.5,
      "letter-spacing": 0.05,
    },
  },
  state: {
    hover: {
      fill: "alpha(@on_surface, 0.08)",
      ink: "@on_surface",
      ring: "@primary",
    },
    selected: {
      fill: "@primary_container",
      ink: "@on_primary_container",
      ring: "@primary",
    },
    focus: { fill: "transparent", ink: "@on_surface", ring: "@primary" },
    disabled: {
      fill: "transparent",
      ink: "alpha(@on_surface, 0.45)",
      ring: "transparent",
    },
  },
  type: {
    "font-family": "Inter, sans-serif",
    "font-weight": 600,
    "letter-spacing": 0.05,
    "size-caption": 10.5,
    "size-meta": 11,
    "size-body": 12,
    "size-title": 15,
    "size-display": 20,
  },
  ink: {
    ink: "@on_surface",
    "ink-dim": "alpha(@on_surface_variant, 0.8)",
    accent: "@primary",
    "accent-muted": "alpha(@primary, 0.45)",
    "ink-over": "auto",
  },
  layout: {
    ags: { "panel-width": 380, "bt-list-spacing": 8, "bar-row-height": 32, "chip-min": 72 },
    "ags-clipboard": { "card-width": 360 },
    "ags-notifications": { "card-width": 360 },
  },
};

export const GLASS_APPEARANCE_JSON = JSON.stringify(GLASS_APPEARANCE);

/** The same document with one top-level group patched (test helper). */
export function appearanceJsonWith(
  group: string,
  value: unknown,
): string {
  return JSON.stringify({ ...GLASS_APPEARANCE, [group]: value });
}

/** The same document with one leaf value patched (test helper). */
export function appearanceJsonWithLeaf(
  group: string,
  role: string,
  token: string,
  value: unknown,
): string {
  const source = GLASS_APPEARANCE as Record<string, Record<string, unknown>>;
  return JSON.stringify({
    ...GLASS_APPEARANCE,
    [group]: {
      ...source[group],
      [role]: {
        ...(source[group][role] as Record<string, unknown>),
        [token]: value,
      },
    },
  });
}

/**
 * A base document plus a complete `mode.light` ink group. The group replaces
 * the base ink group as a whole; no deep merge.
 */
export const GLASS_MODES: Record<string, unknown> = {
  ...GLASS_APPEARANCE,
  mode: {
    light: {
      ink: {
        ink: "@on_surface",
        "ink-dim": "alpha(@on_surface_variant, 0.6)",
        accent: "@tertiary",
        "accent-muted": "alpha(@tertiary, 0.4)",
        "ink-over": "auto",
      },
    },
  },
};

export const GLASS_MODES_JSON = JSON.stringify(GLASS_MODES);

/** Composed CSS — palette block (hex is palette-owned) followed by skin CSS. */
export const COMPOSED_CSS = [
  "@define-color surface #121318;",
  "@define-color on_surface #e3e1e9;",
  "@define-color primary #b9c3ff;",
  "",
  ".appearance-panel {",
  "  background: alpha(@surface, 0.94);",
  "  color: @on_surface;",
  "  padding: 11px;",
  "}",
  "",
].join("\n");

export const COMPOSED_CSS_V2 = COMPOSED_CSS.replace("padding: 11px;", "padding: 15px;");
