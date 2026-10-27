/**
 * Node binding for the template-conformance gate (spine AD-33/AD-34).
 *
 * The pure checks live in `../ports/app-conformance`; this adapter supplies the
 * repository tree from `node:fs`. It is intentionally its own package subpath
 * (`ags-platform/conformance/*`) and is not re-exported from the root entry
 * point: AGS apps run in GJS, which has no `node:fs`, so the runtime bundle
 * must never pull this module in. App CI and local gates use it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  checkAppRepo,
  type AppConformanceOptions,
  type AppConformanceReport,
  type AppRepoReader,
} from "../ports/app-conformance.ts";

/**
 * Directories that are not part of the app repo's authored tree. `.dev/` holds
 * the pinned platform copy; `@girs/` is generated desktop typings; worktrees
 * and build output are copies, not sources.
 */
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".worktrees",
  ".dev",
  "@girs",
  "node_modules",
  "dist",
  "build",
  "coverage",
]);

function toRepoPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

function walk(root: string): string[] {
  const files: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) visit(absolute);
      } else if (entry.isFile()) {
        files.push(toRepoPath(root, absolute));
      }
    }
  }

  visit(root);
  return files.sort();
}

/** Build a reader over a real repo tree. The file list is computed lazily once. */
export function createNodeAppRepoReader(root: string): AppRepoReader {
  let cachedFiles: string[] | null = null;

  return {
    files: () => {
      if (cachedFiles === null) cachedFiles = walk(root);
      return cachedFiles;
    },
    exists: (path) => existsSync(join(root, path)),
    read: (path) => {
      const absolute = join(root, path);
      try {
        return statSync(absolute).isFile() ? readFileSync(absolute, "utf8") : null;
      } catch {
        return null;
      }
    },
  };
}

/** Audit a real app repo rooted at `root`. */
export function checkAppRepoAt(
  root: string,
  options: AppConformanceOptions = {},
): AppConformanceReport {
  return checkAppRepo(createNodeAppRepoReader(resolve(root)), options);
}

/** Render a report for CI logs; the exit code is the caller's decision. */
export function formatAppConformanceReport(
  report: AppConformanceReport,
  label = "app repo",
): string {
  if (report.ok) {
    const manifest = report.manifest;
    const identity = manifest
      ? `${manifest.app}/${manifest.instance}/${manifest.configDir} (${manifest.mode})`
      : "manifest not parsed";
    return `PASS: ${label}\n  manifest: ${identity}`;
  }

  const lines = [
    `FAIL: ${label} (${report.issues.length} issue${report.issues.length === 1 ? "" : "s"})`,
  ];
  for (const issue of report.issues) {
    lines.push(`  [${issue.code}] ${issue.path ?? "-"}: ${issue.message}`);
  }
  return lines.join("\n");
}

export interface AppConformanceCliIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

const USAGE =
  "usage: check-app-conformance [--root <app-repo>] | --help";

/**
 * Run the conformance gate as a CLI. Returns 0 on pass, 1 on issues and 2 on a
 * usage/IO error, so an app repo's `make conformance` can use it directly.
 */
export function runAppConformanceCli(
  args: readonly string[],
  io: AppConformanceCliIo = {
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  },
): number {
  let root: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      io.log(USAGE);
      return 0;
    }
    if (arg === "--root") {
      const value = args[index + 1];
      if (value === undefined) {
        io.error(USAGE);
        return 2;
      }
      root = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      io.error(`unknown option: ${arg}\n${USAGE}`);
      return 2;
    }
    if (root !== undefined) {
      io.error(`unexpected extra argument: ${arg}\n${USAGE}`);
      return 2;
    }
    root = arg;
  }

  const target = root ?? process.cwd();
  try {
    const report = checkAppRepoAt(target);
    io.log(formatAppConformanceReport(report, target));
    return report.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.error(`cannot audit ${target}: ${message}`);
    return 2;
  }
}
