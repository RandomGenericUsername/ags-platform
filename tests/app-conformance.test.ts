import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  AGS_APP_REQUIRED_FILES,
  checkAppRepo,
  type AppConformanceReport,
  type AppRepoReader,
} from "../ports/app-conformance.ts"
import {
  checkAppRepoAt,
  formatAppConformanceReport,
  runAppConformanceCli,
} from "../conformance/app-conformance.ts"

const LIVE_MANIFEST = {
  schemaVersion: 1,
  app: "clipboard",
  instance: "clipboard",
  configDir: "ags-clipboard",
  mode: "live",
  holdsUnsavedState: false,
}

const HANDLER_SOURCE = [
  'import { createPaletteRefreshHandler } from "ags-platform"',
  "app.start({",
  "  requestHandler: createPaletteRefreshHandler(() => ({ status: \"applied\" })),",
  "})",
].join("\n")

/** A complete app repo. Each test deletes or mutates one thing. */
function baseFiles(): Record<string, string> {
  return {
    "AGENTS.md": "# AGENTS\n",
    "README.md": "# app\n",
    "Makefile": "test:\n\t@true\n",
    "app.tsx": HANDLER_SOURCE,
    "app.manifest.json": JSON.stringify(LIVE_MANIFEST, null, 2),
    "scripts/worktree-guard.sh": "#!/usr/bin/env bash\n",
    "tickets/LIFECYCLE.md": "# lifecycle\n",
    "tickets/INDEX.md": "- [REQ-001-first/ticket.md](./REQ-001-first/ticket.md)\n",
    "tickets/_template/requirement.md": "---\nstatus: proposed\n---\n",
    "tickets/REQ-001-first/ticket.md": "---\nid: REQ-001\nstatus: done\n---\n",
    ".github/workflows/ci.yml": "name: ci\n",
    "tests/contract.test.ts": "// pure test\n",
  }
}

/** A reader over an in-memory tree; the host side is exercised separately. */
function fakeReader(contents: Record<string, string>): AppRepoReader {
  const files = Object.keys(contents).sort()
  return {
    files: () => files,
    exists: (path) =>
      path in contents ||
      files.some((file) => file.startsWith(`${path.replace(/\/$/, "")}/`)),
    read: (path) => contents[path] ?? null,
  }
}

function audit(contents: Record<string, string>): AppConformanceReport {
  return checkAppRepo(fakeReader(contents))
}

function issuePaths(report: AppConformanceReport): string[] {
  return report.issues.map((issue) => issue.path ?? "")
}

function writeTree(root: string, contents: Record<string, string>): void {
  for (const [path, text] of Object.entries(contents)) {
    const file = join(root, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
}

test("a complete live app repo passes the template gate", () => {
  const report = audit(baseFiles())
  assert.equal(report.ok, true, JSON.stringify(report.issues))
  assert.equal(report.manifest?.mode, "live")
  assert.deepEqual(report.issues, [])
})

test("a restart app passes without a palette-refresh handler", () => {
  const files = baseFiles()
  files["app.manifest.json"] = JSON.stringify({ ...LIVE_MANIFEST, mode: "restart" })
  files["app.tsx"] = "app.start({ main() {} })\n"

  const report = audit(files)
  assert.equal(report.ok, true, JSON.stringify(report.issues))
  assert.equal(report.manifest?.mode, "restart")
})

test("missing required repo files are reported by path", () => {
  for (const required of AGS_APP_REQUIRED_FILES) {
    const files = baseFiles()
    delete files[required]
    const report = audit(files)
    assert.equal(report.ok, false, `${required} must be required`)
    assert.ok(
      issuePaths(report).includes(required),
      `${required} must be named: ${JSON.stringify(report.issues)}`,
    )
  }

  const noCI = baseFiles()
  delete noCI[".github/workflows/ci.yml"]
  assert.ok(issuePaths(audit(noCI)).includes(".github/workflows/"))

  const noTests = baseFiles()
  delete noTests["tests/contract.test.ts"]
  assert.ok(issuePaths(audit(noTests)).includes("tests/"))

  const noTemplate = baseFiles()
  delete noTemplate["tickets/_template/requirement.md"]
  assert.ok(issuePaths(audit(noTemplate)).includes("tickets/_template/"))
})

test("manifest identity, shape and the restart/unsaved-state rule are validated", () => {
  const badIdentity = baseFiles()
  badIdentity["app.manifest.json"] = JSON.stringify({
    ...LIVE_MANIFEST,
    configDir: "ags/clipboard",
  })
  let report = audit(badIdentity)
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((issue) => issue.code === "manifest-invalid"))
  assert.ok(report.issues.some((issue) => issue.message.includes("configDir")))

  const restartUnsaved = baseFiles()
  restartUnsaved["app.manifest.json"] = JSON.stringify({
    ...LIVE_MANIFEST,
    mode: "restart",
    holdsUnsavedState: true,
  })
  report = audit(restartUnsaved)
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((issue) => issue.code === "manifest-invalid"))

  const badJSON = baseFiles()
  badJSON["app.manifest.json"] = "{not json"
  report = audit(badJSON)
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((issue) => issue.code === "manifest-invalid"))
})

test("live mode requires a handler in app source, not only in tests", () => {
  const noHandler = baseFiles()
  noHandler["app.tsx"] = "app.start({ main() {} })\n"
  noHandler["tests/palette-refresh.test.ts"] =
    'const name = "palette-refresh"\napp.requestHandler\ncreatePaletteRefreshHandler\n'
  let report = audit(noHandler)
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((issue) => issue.code === "live-handler-missing"))

  const notRegistered = baseFiles()
  notRegistered["app.tsx"] =
    'import { createPaletteRefreshHandler } from "ags-platform"\nconst handler = createPaletteRefreshHandler(() => ({ status: "applied" }))\n'
  report = audit(notRegistered)
  assert.equal(report.ok, false)
  assert.ok(
    report.issues.some((issue) => issue.code === "live-handler-registration-missing"),
  )
})

test("ticket flow checks the template, ticket files and the INDEX rollup", () => {
  const unlisted = baseFiles()
  unlisted["tickets/REQ-002-unlisted/ticket.md"] = "---\nstatus: proposed\n---\n"
  let report = audit(unlisted)
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((issue) => issue.code === "ticket-index"))

  const missingTicket = baseFiles()
  missingTicket["tickets/REQ-003-no-ticket/notes.md"] = "notes\n"
  report = audit(missingTicket)
  assert.equal(report.ok, false)
  assert.ok(report.issues.some((issue) => issue.code === "ticket-file"))
})

test("the Node adapter audits a real tree and reports CLI pass/fail", () => {
  const root = mkdtempSync(join(tmpdir(), "ags-app-conformance-"))
  try {
    writeTree(root, baseFiles())

    const pass = checkAppRepoAt(root)
    assert.equal(pass.ok, true, JSON.stringify(pass.issues))

    const logs: string[] = []
    const errors: string[] = []
    const io = { log: (line: string) => logs.push(line), error: (line: string) => errors.push(line) }
    assert.equal(runAppConformanceCli([root], io), 0)
    assert.match(logs.join("\n"), /PASS/)

    rmSync(join(root, "AGENTS.md"))
    const fail = checkAppRepoAt(root)
    assert.equal(fail.ok, false)
    assert.ok(fail.issues.some((issue) => issue.path === "AGENTS.md"))
    assert.match(formatAppConformanceReport(fail), /FAIL/)
    assert.equal(runAppConformanceCli(["--root", root], io), 1)
    assert.deepEqual(errors, [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
