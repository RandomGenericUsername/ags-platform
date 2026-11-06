/**
 * Generations v3 fixtures for the stock test runner.
 *
 * Shapes follow contracts `v0.8.0`
 * (`schemas/generation-manifest.schema.json` and `generations.md` §2). The
 * token document itself stays `appearance.v2`; Generations v3 is the identity
 * and read plane around it.
 */

export const GENERATION_A = "a".repeat(64);
export const GENERATION_B = "b".repeat(64);
export const GENERATION_C = "c".repeat(64);

export interface GenerationFixtureOptions {
  readonly configDirs?: readonly string[];
  readonly mode?: "dark" | "light";
  readonly generationHash?: string;
}

/** A complete v3 manifest shaped like the frozen contract example. */
export function generationManifest(
  genHash: string,
  options: GenerationFixtureOptions = {},
): Record<string, unknown> {
  const configDirs = options.configDirs ?? ["ags-clipboard"];
  const mode = options.mode ?? "dark";
  return {
    version: 3,
    generationHash: genHash,
    created: { at: "2026-11-06T12:00:00Z", by: "dotfiles-runtime-test" },
    committed: { at: "2026-11-06T12:00:01Z", jobId: "converge-test" },
    layers: {
      wallpaper: { entryHash: GENERATION_A, path: "wallpaper" },
      palette: { entryHash: GENERATION_B, path: "palette" },
    },
    skin: { name: "glass", entryHash: GENERATION_C, mode },
    appearance: {
      tokensPath: "appearance/tokens.json",
      targets: configDirs.map((configDir) => ({
        configDir,
        path: `appearance/${configDir}.css`,
      })),
    },
    mode,
    intent: {
      wallpaper: GENERATION_A,
      palette: GENERATION_B,
      skin: "glass",
      mode,
    },
    source: { kind: "cli", intentHash: GENERATION_C },
  };
}

export function generationManifestJson(
  genHash: string,
  options: GenerationFixtureOptions = {},
): string {
  return JSON.stringify(generationManifest(genHash, options));
}
