/**
 * The pure template-conformance gate for standalone AGS app repos (spine
 * AD-33/AD-34).
 *
 * Every app repo carries the same dev flow: AGENTS.md, tickets
 * (LIFECYCLE/INDEX/_template), the worktree guard, Makefile, CI, README,
 * `app.manifest.json`, tests and — for live apps — a `palette-refresh`
 * handler. This module owns the checks; the host-side reader lives in
 * `../conformance/app-conformance` (Node `fs`) so the core stays pure and the
 * same logic can be exercised with an in-memory tree.
 *
 * WHAT THIS GATE CAN AND CANNOT PROVE. It proves the required files exist, the
 * manifest matches the contracts schema (shape + identity-field format), and a
 * live app's source mentions the handler and registers a `requestHandler`.
 * It cannot compare `instance`/`configDir` with a deployed link or a running
 * process, and it cannot prove the handler's behavior: those are runtime and
 * app-test responsibilities (AD-26/AD-27). No app-specific path or policy is
 * encoded here — only the shared template.
 *
 * PURE: no `ags`, no `gi://*`, no I/O.
 */

import {
  AGS_APP_MANIFEST_FILE,
  parseAgsAppManifest,
  type AgsAppManifest,
} from "./app-manifest.ts";
import { PALETTE_REFRESH_COMMAND } from "./palette-refresh.ts";

/** The files every app repo carries (AD-33's template). */
export const AGS_APP_REQUIRED_FILES = [
  "AGENTS.md",
  "README.md",
  "Makefile",
  "app.tsx",
  AGS_APP_MANIFEST_FILE,
  "scripts/worktree-guard.sh",
  "tickets/LIFECYCLE.md",
  "tickets/INDEX.md",
] as const;

/**
 * The minimal read-only view of a repo the gate needs. Paths are repo-relative
 * and use `/` separators. The Node adapter supplies the real tree; tests supply
 * a map.
 */
export interface AppRepoReader {
  /** All repo-relative file paths (including tickets/tests/CI). */
  files(): readonly string[];
  /** True when the path exists as a file or directory. */
  exists(path: string): boolean;
  /** File text, or null when missing/not a readable file. */
  read(path: string): string | null;
}

export interface AppConformanceIssue {
  code:
    | "missing-file"
    | "manifest-invalid"
    | "live-handler-missing"
    | "live-handler-registration-missing"
    | "ticket-file"
    | "ticket-index";
  path?: string;
  message: string;
}

export interface AppConformanceReport {
  ok: boolean;
  manifest: AgsAppManifest | null;
  issues: AppConformanceIssue[];
}

export interface AppConformanceOptions {
  /** Extra repo-relative files this app's template requires. */
  extraRequiredFiles?: readonly string[];
}

const SOURCE_FILE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

/**
 * Files that are not the app's runtime source. A handler mentioned only in a
 * test, a copied template or a ticket must not satisfy the live-mode check.
 */
const NON_SOURCE_PREFIXES = [
  "node_modules/",
  ".git/",
  ".worktrees/",
  ".agents/",
  ".dev/",
  "_bmad/",
  "dist/",
  "build/",
  "coverage/",
  "@girs/",
  "templates/",
  "tests/",
  "tickets/",
  ".github/",
];

/** The tokens any handler path uses: the command literal, its constant, or the helper. */
const HANDLER_TOKENS = [
  PALETTE_REFRESH_COMMAND,
  "PALETTE_REFRESH_COMMAND",
  "createPaletteRefreshHandler",
];

function isAppSourceFile(path: string): boolean {
  return (
    SOURCE_FILE.test(path) &&
    !NON_SOURCE_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

function isWorkflow(path: string): boolean {
  const parts = path.split("/");
  return (
    parts.length === 3 &&
    parts[0] === ".github" &&
    parts[1] === "workflows" &&
    (parts[2].endsWith(".yml") || parts[2].endsWith(".yaml"))
  );
}

function ticketDirectories(files: readonly string[]): Set<string> {
  const directories = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    if (
      parts.length >= 3 &&
      parts[0] === "tickets" &&
      parts[1] !== "_template" &&
      parts[1] !== "_fixtures"
    ) {
      directories.add(parts[1]);
    }
  }
  return directories;
}

/**
 * Audit one app repo against the shared template contract.
 *
 * The report is deterministic: required files first, then CI/tests/template,
 * manifest, live handler, and ticket flow. `ok` is true only when `issues` is
 * empty.
 */
export function checkAppRepo(
  reader: AppRepoReader,
  options: AppConformanceOptions = {},
): AppConformanceReport {
  const issues: AppConformanceIssue[] = [];
  const files = reader.files();

  for (const required of [
    ...AGS_APP_REQUIRED_FILES,
    ...(options.extraRequiredFiles ?? []),
  ]) {
    if (!reader.exists(required)) {
      issues.push({
        code: "missing-file",
        path: required,
        message: "required app-repo file is missing",
      });
    }
  }

  if (!files.some(isWorkflow)) {
    issues.push({
      code: "missing-file",
      path: ".github/workflows/",
      message: "at least one CI workflow is required",
    });
  }

  if (!files.some((file) => file.startsWith("tests/"))) {
    issues.push({
      code: "missing-file",
      path: "tests/",
      message: "the app repo must carry tests",
    });
  }

  if (
    !files.some(
      (file) => file.startsWith("tickets/_template/") && file.endsWith(".md"),
    )
  ) {
    issues.push({
      code: "missing-file",
      path: "tickets/_template/",
      message: "the ticket template directory must carry at least one markdown template",
    });
  }

  let manifest: AgsAppManifest | null = null;
  const manifestText = reader.read(AGS_APP_MANIFEST_FILE);
  if (manifestText === null) {
    // The required-files pass already reported an absent manifest; only add a
    // second issue when the file exists but cannot be read as text.
    if (
      !issues.some(
        (issue) =>
          issue.code === "missing-file" && issue.path === AGS_APP_MANIFEST_FILE,
      )
    ) {
      issues.push({
        code: "missing-file",
        path: AGS_APP_MANIFEST_FILE,
        message: "the app manifest is missing or unreadable",
      });
    }
  } else {
    const parsed = parseAgsAppManifest(manifestText);
    if (parsed.ok) {
      manifest = parsed.manifest;
    } else {
      for (const issue of parsed.issues) {
        issues.push({
          code: "manifest-invalid",
          path: `${AGS_APP_MANIFEST_FILE}#${issue.path}`,
          message: issue.message,
        });
      }
    }
  }

  if (manifest?.mode === "live") {
    const source = files
      .filter(isAppSourceFile)
      .map((file) => reader.read(file) ?? "")
      .join("\n");

    if (!HANDLER_TOKENS.some((token) => source.includes(token))) {
      issues.push({
        code: "live-handler-missing",
        path: "app.tsx",
        message:
          "a live app must implement the palette-refresh command or use createPaletteRefreshHandler",
      });
    }
    if (!source.includes("requestHandler")) {
      issues.push({
        code: "live-handler-registration-missing",
        path: "app.tsx",
        message: "the palette-refresh handler must be registered as requestHandler",
      });
    }
  }

  const indexText = reader.read("tickets/INDEX.md");
  for (const directory of ticketDirectories(files)) {
    const ticket = `tickets/${directory}/ticket.md`;
    if (!reader.exists(ticket)) {
      issues.push({
        code: "ticket-file",
        path: ticket,
        message: "every ticket directory must contain ticket.md",
      });
      continue;
    }
    // INDEX entries are relative to `tickets/` (`./REQ-.../ticket.md`) in the
    // platform template, but apps may spell the repo-relative path. Both forms
    // contain the same `<dir>/ticket.md` suffix.
    if (indexText !== null && !indexText.includes(`${directory}/ticket.md`)) {
      issues.push({
        code: "ticket-index",
        path: ticket,
        message: `${ticket} is not listed in tickets/INDEX.md`,
      });
    }
  }

  return { ok: issues.length === 0, manifest, issues };
}
