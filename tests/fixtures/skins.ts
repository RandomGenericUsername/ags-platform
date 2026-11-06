/**
 * Resolved token maps for the three built-in skins.
 *
 * Source: `dotfiles-assets/skins/manifests/{glass,flat,paper}.toml` (v0.9.1)
 * plus the contracts v0.6.0 `shape.hairline-w` numeric token. The source
 * checkout in this workspace predates that token, so the values here are the
 * resolved document the runtime will emit: `glass` keeps its 1.5px panel
 * border and 1px hairlines, `flat` has neither, `paper` keeps a 1px hairline.
 * No cross-repo import: the stock test runner has no access to the assets
 * repository, so the maps are hard-coded and reviewed with this comment.
 *
 * Each map has all 24 tokens: 13 numbers, 3 paints, shadow + blur, 3 ink
 * expressions + `ink-over: auto`, the font family, `cell-pad`, and 4 layout
 * numbers.
 */

export interface SkinFixture {
  version: number;
  shape: Record<string, number>;
  surface: Record<string, string>;
  ink: Record<string, string>;
  type: Record<string, string | number>;
  rhythm: Record<string, string | number>;
  layout: Record<string, number>;
}

/** `skins/manifests/glass.toml` — the default/fallback skin. */
export const GLASS_SKIN: SkinFixture = {
  version: 1,
  shape: {
    "radius-panel": 12,
    "radius-card": 9,
    "radius-cell": 7,
    "radius-pill": 20,
    "border-w": 1.5,
    "hairline-w": 1,
  },
  surface: {
    "bg-panel": "alpha(@surface, 0.94)",
    "bg-card": "alpha(@surface_container_high, 0.18)",
    border: "@primary",
    shadow: "none",
    blur: "none",
  },
  ink: {
    ink: "@on_surface",
    "ink-dim": "alpha(@on_surface, 0.62)",
    accent: "@primary",
    "ink-over": "auto",
  },
  type: {
    "font-family": "inherit",
    "title-size": 12.5,
    "text-size": 13,
  },
  rhythm: {
    gap: 8,
    "cell-pad": "8px 9px",
  },
  layout: {
    "panel-width": 312,
    "bt-list-spacing": 4,
    "bar-row-height": 0,
    "chip-min": 0,
  },
};

/** `skins/manifests/flat.toml` — zero chrome, tighter rhythm. */
export const FLAT_SKIN: SkinFixture = {
  version: 1,
  shape: {
    "radius-panel": 0,
    "radius-card": 0,
    "radius-cell": 0,
    "radius-pill": 999,
    "border-w": 0,
    "hairline-w": 0,
  },
  surface: {
    "bg-panel": "transparent",
    "bg-card": "transparent",
    border: "transparent",
    shadow: "none",
    blur: "none",
  },
  ink: {
    ink: "@on_surface",
    "ink-dim": "@on_surface_variant",
    accent: "@primary",
    "ink-over": "auto",
  },
  type: {
    "font-family": 'system-ui, "Cantarell", "Noto Sans", sans-serif',
    "title-size": 15,
    "text-size": 13,
  },
  rhythm: {
    gap: 8,
    "cell-pad": "7px 8px",
  },
  layout: {
    "panel-width": 312,
    "bt-list-spacing": 4,
    "bar-row-height": 28,
    "chip-min": 48,
  },
};

/** `skins/manifests/paper.toml` — palette-axis skin with a soft shadow. */
export const PAPER_SKIN: SkinFixture = {
  version: 1,
  shape: {
    "radius-panel": 6,
    "radius-card": 4,
    "radius-cell": 3,
    "radius-pill": 999,
    "border-w": 1,
    "hairline-w": 1,
  },
  surface: {
    "bg-panel": "@surface_container_lowest",
    "bg-card": "@surface_container_low",
    border: "alpha(@on_surface, 0.22)",
    shadow: "0 10px 28px rgba(0,0,0,0.22)",
    blur: "none",
  },
  ink: {
    ink: "@on_surface",
    "ink-dim": "@on_surface_variant",
    accent: "@primary",
    "ink-over": "auto",
  },
  type: {
    "font-family": 'system-ui, "Cantarell", "Noto Sans", sans-serif',
    "title-size": 15,
    "text-size": 13,
  },
  rhythm: {
    gap: 9,
    "cell-pad": "8px 10px",
  },
  layout: {
    "panel-width": 312,
    "bt-list-spacing": 6,
    "bar-row-height": 30,
    "chip-min": 52,
  },
};

export const BUILTIN_SKINS = Object.freeze({
  glass: GLASS_SKIN,
  flat: FLAT_SKIN,
  paper: PAPER_SKIN,
});
