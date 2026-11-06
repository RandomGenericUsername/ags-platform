import { test } from "node:test"
import assert from "node:assert/strict"
import {
  APPEARANCE_PROVIDER_PRIORITY,
  AppearanceManifestError,
  createReplacingAppearanceCssSink,
  generationAppearanceTarget,
  isGenerationHash,
  parseGenerationManifest,
  resolveAppearancePaths,
  type AppearanceCssHost,
} from "../ports/appearance.ts"
import {
  APPEARANCE_REFRESH_COMMAND,
  createAppearanceRefreshHandler,
} from "../ports/appearance-refresh.ts"
import { createScopedAppearance as createAppearance } from "../adapters/appearance-scope.ts"
import { fakeRuntime } from "./_fake-runtime.ts"
import {
  COMPOSED_CSS,
  COMPOSED_CSS_V2,
  GLASS_APPEARANCE_JSON,
  appearanceJsonWithLeaf,
} from "./fixtures/appearances.ts"
import {
  GENERATION_A,
  GENERATION_B,
  GENERATION_C,
  generationManifestJson,
} from "./fixtures/generations.ts"

const STATE_HOME = "/state"
const CONFIG_DIR = "ags-clipboard"
const PATHS = resolveAppearancePaths(CONFIG_DIR, STATE_HOME)
const DIRECT_A = `${PATHS.generationsPath}/${GENERATION_A}`
const CURRENT_CSS = `${PATHS.currentPath}/appearance/${CONFIG_DIR}.css`
const CURRENT_TOKENS = `${PATHS.currentPath}/appearance/tokens.json`

function fakeDisplay() {
  let nextId = 1
  const installed: Array<{ id: number; css: string; priority: number }> = []
  const allPriorities: number[] = []
  const ops: string[] = []
  let peakInstalled = 0
  const host: AppearanceCssHost = {
    add(css: string, priority: number) {
      const provider = { id: nextId++, css, priority }
      installed.push(provider)
      allPriorities.push(priority)
      ops.push(`add:${provider.id}`)
      peakInstalled = Math.max(peakInstalled, installed.length)
      return provider
    },
    remove(provider) {
      const index = installed.indexOf(provider as { id: number; css: string; priority: number })
      assert.notEqual(index, -1, "the sink removed a provider it did not add")
      const [removed] = installed.splice(index, 1)
      ops.push(`remove:${removed.id}`)
    },
  }
  return {
    host,
    ops,
    installed,
    css: () => installed.map((provider) => provider.css),
    priorities: () => installed.map((provider) => provider.priority),
    allPriorities,
    peakInstalled: () => peakInstalled,
  }
}

function fakeFiles(initial: Readonly<Record<string, string>> = {}) {
  const files = new Map(Object.entries(initial))
  const reads: string[] = []
  const watchers: Array<{ path: string; onChange: () => void; active: boolean }> = []
  return {
    readFile(path: string): string | null {
      reads.push(path)
      return files.has(path) ? (files.get(path) as string) : null
    },
    watchFile(path: string, onChange: () => void): () => void {
      const watcher = { path, onChange, active: true }
      watchers.push(watcher)
      return (): void => {
        watcher.active = false
      }
    },
    write(path: string, content: string): void {
      files.set(path, content)
    },
    remove(path: string): void {
      files.delete(path)
    },
    emit(path: string): void {
      for (const watcher of watchers) {
        if (watcher.active && watcher.path === path) watcher.onChange()
      }
    },
    reads,
    watchers,
    activeWatchers: () => watchers.filter((watcher) => watcher.active),
  }
}

interface GenerationWrite {
  readonly css?: string
  readonly tokens?: string
  readonly direct?: boolean
}

/** Write the committed current generation and optionally its immutable tree. */
function writeGeneration(
  files: ReturnType<typeof fakeFiles>,
  genHash: string,
  options: GenerationWrite = {},
): void {
  const css = options.css ?? COMPOSED_CSS
  const tokens = options.tokens ?? GLASS_APPEARANCE_JSON
  files.write(PATHS.manifestPath, generationManifestJson(genHash))
  files.write(CURRENT_CSS, css)
  files.write(CURRENT_TOKENS, tokens)
  if (options.direct !== false) {
    const dir = `${PATHS.generationsPath}/${genHash}`
    files.write(`${dir}/manifest.json`, generationManifestJson(genHash))
    files.write(`${dir}/appearance/${CONFIG_DIR}.css`, css)
    files.write(`${dir}/appearance/tokens.json`, tokens)
  }
}

function setup() {
  const display = fakeDisplay()
  const files = fakeFiles()
  const errors: unknown[] = []
  const appearance = createAppearance({
    configDir: CONFIG_DIR,
    stateHome: STATE_HOME,
    sink: createReplacingAppearanceCssSink(display.host),
    runtime: fakeRuntime(),
    readFile: files.readFile,
    watchFile: files.watchFile,
    onError: (error) => errors.push(error),
  })
  return { appearance, display, files, errors }
}

test("the v3 manifest verifies version, identity, tokensPath and exact targets", () => {
  const manifest = parseGenerationManifest(generationManifestJson(GENERATION_A))
  assert.equal(manifest.version, 3)
  assert.equal(manifest.generationHash, GENERATION_A)
  assert.equal(manifest.appearance.tokensPath, "appearance/tokens.json")
  assert.deepEqual(manifest.appearance.targets, [
    { configDir: CONFIG_DIR, path: `appearance/${CONFIG_DIR}.css` },
  ])
  assert.equal(generationAppearanceTarget(manifest, CONFIG_DIR).configDir, CONFIG_DIR)
  assert.equal(isGenerationHash(GENERATION_A), true)
  assert.equal(isGenerationHash("A".repeat(64)), false)

  assert.throws(
    () => parseGenerationManifest(JSON.stringify({ ...JSON.parse(generationManifestJson(GENERATION_A)), version: 2 })),
    /unsupported generation manifest version/,
  )
  assert.throws(
    () =>
      parseGenerationManifest(
        JSON.stringify({ ...JSON.parse(generationManifestJson(GENERATION_A)), generationHash: "short" }),
      ),
    /64-character SHA-256/,
  )
  assert.throws(
    () => generationAppearanceTarget(manifest, "ags-missing"),
    /does not publish/,
  )
  const wrongTargets = JSON.parse(generationManifestJson(GENERATION_A)) as {
    appearance: { targets: Array<{ configDir: string; path: string }> }
  }
  wrongTargets.appearance.targets[0].path = "appearance/ags-other.css"
  assert.throws(
    () => parseGenerationManifest(JSON.stringify(wrongTargets)),
    /expected "appearance\/ags-clipboard\.css"/,
  )
  const duplicate = JSON.parse(generationManifestJson(GENERATION_A)) as {
    appearance: { targets: Array<{ configDir: string; path: string }> }
  }
  duplicate.appearance.targets.push({ ...duplicate.appearance.targets[0] })
  assert.throws(
    () => parseGenerationManifest(JSON.stringify(duplicate)),
    /duplicate configDir/,
  )
  const modeMismatch = JSON.parse(generationManifestJson(GENERATION_A)) as {
    mode: string
    skin: { mode: string }
  }
  modeMismatch.skin.mode = "light"
  assert.throws(
    () => parseGenerationManifest(JSON.stringify(modeMismatch)),
    /skin\.mode/,
  )
  assert.throws(() => parseGenerationManifest("{"), AppearanceManifestError)
})

test("consumer paths are state-only and watch only current", () => {
  assert.equal(PATHS.currentPath, "/state/dotfiles/current")
  assert.equal(PATHS.manifestPath, "/state/dotfiles/current/manifest.json")
  assert.equal(PATHS.generationsPath, "/state/dotfiles/generations")
  assert.equal(PATHS.currentAppearancePath, "/state/dotfiles/current/appearance")
  assert.equal(PATHS.tokensPath, "/state/dotfiles/current/appearance/tokens.json")
  assert.equal(PATHS.appearanceCssPath, "/state/dotfiles/current/appearance/ags-clipboard.css")
  assert.doesNotMatch(JSON.stringify(PATHS), /\/cfg|XDG_CONFIG_HOME|appearance\.css$/)
})

test("applyGeneration prefers generations/<genHash>/... over current", () => {
  const { appearance, display, files, errors } = setup()
  writeGeneration(files, GENERATION_A, { css: COMPOSED_CSS, direct: true })
  // A different current copy proves the immutable generation path is read.
  files.write(CURRENT_CSS, COMPOSED_CSS)
  files.write(`${DIRECT_A}/appearance/${CONFIG_DIR}.css`, COMPOSED_CSS_V2)

  const result = appearance.applyGeneration(GENERATION_A)

  assert.deepEqual(result, { status: "applied", genHash: GENERATION_A })
  assert.equal(appearance.appliedHash(), GENERATION_A)
  assert.deepEqual(display.css(), [COMPOSED_CSS_V2])
  assert.equal(display.allPriorities[0], 800)
  assert.equal(errors.length, 0)
  assert.ok(files.reads.includes(`${DIRECT_A}/appearance/${CONFIG_DIR}.css`))
  assert.ok(files.reads.includes(`${DIRECT_A}/appearance/tokens.json`))
  assert.ok(files.reads.every((path) => path.startsWith("/state/dotfiles")))
  assert.ok(!files.reads.some((path) => path.includes("/cfg")))
})

test("tokens are read from the v3 generation path and exposed to value()", () => {
  const { appearance, files } = setup()
  const tokens = appearanceJsonWithLeaf("surface", "panel", "radius", 24)
  writeGeneration(files, GENERATION_A, { tokens })

  assert.equal(appearance.value("surface.panel.radius", 12)(), 12)
  assert.equal(appearance.applyGeneration(GENERATION_A).status, "applied")
  assert.equal(appearance.value("surface.panel.radius", 12)(), 24)
  assert.equal(appearance.tokens().version, 2)
  assert.ok(files.reads.includes(`${DIRECT_A}/appearance/tokens.json`))
})

test("a stale pointer is deferred with the requested hash and applies nothing", () => {
  const { appearance, display, files, errors } = setup()
  writeGeneration(files, GENERATION_B, { direct: true })
  // The requested generation still exists immutably, but current moved to B.
  files.write(`${PATHS.generationsPath}/${GENERATION_A}/manifest.json`, generationManifestJson(GENERATION_A))
  files.write(`${PATHS.generationsPath}/${GENERATION_A}/appearance/${CONFIG_DIR}.css`, COMPOSED_CSS_V2)
  files.write(`${PATHS.generationsPath}/${GENERATION_A}/appearance/tokens.json`, GLASS_APPEARANCE_JSON)

  const result = appearance.applyGeneration(GENERATION_A)

  assert.deepEqual(result, {
    status: "deferred",
    reason: `current generation moved to ${GENERATION_B}`,
    genHash: GENERATION_A,
  })
  assert.equal(appearance.appliedHash(), null)
  assert.deepEqual(display.ops, [])
  assert.equal(errors.length, 0)
})

test("a hash mismatch is never applied", () => {
  const { appearance, display, files } = setup()
  writeGeneration(files, GENERATION_A, { direct: true })
  // The requested generation directory names a different generation. The
  // immutable path must not be trusted just because current matches.
  files.write(`${DIRECT_A}/manifest.json`, generationManifestJson(GENERATION_C))
  files.write(`${DIRECT_A}/appearance/${CONFIG_DIR}.css`, COMPOSED_CSS_V2)

  const result = appearance.applyGeneration(GENERATION_A)

  assert.equal(result.status, "failed")
  assert.equal(result.genHash, GENERATION_A)
  assert.equal(appearance.appliedHash(), null)
  assert.deepEqual(display.ops, [])
  assert.ok(!display.css().includes(COMPOSED_CSS_V2))
})

test("a manifest hash that changes during the read defers and never installs", () => {
  const display = fakeDisplay()
  const files = fakeFiles()
  const errors: unknown[] = []
  writeGeneration(files, GENERATION_A, { direct: true })
  const readFile = (path: string): string | null => {
    const result = files.readFile(path)
    // Flip the pointer only after the direct sheet was read: the after-check
    // must catch the move and refuse to install.
    if (path === `${DIRECT_A}/appearance/${CONFIG_DIR}.css`) {
      files.write(PATHS.manifestPath, generationManifestJson(GENERATION_B))
    }
    return result
  }
  const appearance = createAppearance({
    configDir: CONFIG_DIR,
    stateHome: STATE_HOME,
    sink: createReplacingAppearanceCssSink(display.host),
    runtime: fakeRuntime(),
    readFile,
    watchFile: files.watchFile,
    onError: (error) => errors.push(error),
  })

  const result = appearance.applyGeneration(GENERATION_A)

  assert.deepEqual(result, {
    status: "deferred",
    reason: "current generation moved during read",
    genHash: GENERATION_A,
  })
  assert.equal(appearance.appliedHash(), null)
  assert.deepEqual(display.ops, [])
  assert.equal(errors.length, 0)
})

test("exactly one provider apply per generation, add-before-remove on the next", () => {
  const { appearance, display, files } = setup()
  writeGeneration(files, GENERATION_A, { direct: true })

  assert.equal(appearance.apply()?.status, "applied")
  assert.equal(appearance.apply()?.status, "applied")
  assert.equal(appearance.applyGeneration(GENERATION_A).status, "applied")
  assert.deepEqual(display.ops, ["add:1"], "a repeated hash installs once")
  assert.equal(appearance.appliedHash(), GENERATION_A)

  const unsubscribe = appearance.subscribe(() => {})
  writeGeneration(files, GENERATION_B, { direct: true, css: COMPOSED_CSS_V2 })
  files.emit(PATHS.currentPath)
  files.emit(PATHS.currentPath)

  assert.deepEqual(display.ops, ["add:1", "add:2", "remove:1"])
  assert.equal(display.peakInstalled(), 2)
  assert.deepEqual(display.priorities(), [800])
  assert.equal(appearance.appliedHash(), GENERATION_B)
  assert.equal(display.css()[0], COMPOSED_CSS_V2)

  // The same committed generation is not re-installed by another event.
  files.emit(PATHS.currentPath)
  assert.deepEqual(display.ops, ["add:1", "add:2", "remove:1"])
  unsubscribe()
})

test("a commit landing between reads is re-resolved by apply()", () => {
  const display = fakeDisplay()
  const files = fakeFiles()
  writeGeneration(files, GENERATION_B, { direct: true, css: COMPOSED_CSS_V2 })
  writeGeneration(files, GENERATION_A, { direct: true })
  let flipped = false
  const readFile = (path: string): string | null => {
    const result = files.readFile(path)
    if (!flipped && path === PATHS.manifestPath) {
      flipped = true
      files.write(PATHS.manifestPath, generationManifestJson(GENERATION_B))
    }
    return result
  }
  const appearance = createAppearance({
    configDir: CONFIG_DIR,
    stateHome: STATE_HOME,
    sink: createReplacingAppearanceCssSink(display.host),
    runtime: fakeRuntime(),
    readFile,
    watchFile: files.watchFile,
  })

  const result = appearance.apply()

  assert.deepEqual(result, { status: "applied", genHash: GENERATION_B })
  assert.equal(appearance.appliedHash(), GENERATION_B)
  assert.deepEqual(display.css(), [COMPOSED_CSS_V2])
})

test("one watcher on current, none on current/appearance or the config link", () => {
  const { appearance, display, files } = setup()
  writeGeneration(files, GENERATION_A, { direct: true })
  const unsubscribe = appearance.subscribe(() => {})

  assert.deepEqual(
    files.activeWatchers().map((watcher) => watcher.path),
    [PATHS.currentPath],
  )
  assert.ok(!files.activeWatchers().some((watcher) => watcher.path === PATHS.currentAppearancePath))
  assert.ok(!files.activeWatchers().some((watcher) => watcher.path.includes("/cfg")))

  // The generation change event is what triggers the apply.
  writeGeneration(files, GENERATION_B, { direct: true, css: COMPOSED_CSS_V2 })
  files.emit(PATHS.currentPath)
  assert.equal(display.css()[0], COMPOSED_CSS_V2)
  unsubscribe()
  assert.equal(files.activeWatchers().length, 0)
})

test("two app instances own their provider sink and one current watcher each", () => {
  const one = setup()
  const two = setup()
  writeGeneration(one.files, GENERATION_A, { direct: true })
  writeGeneration(two.files, GENERATION_B, { direct: true, css: COMPOSED_CSS_V2 })
  const stopOne = one.appearance.subscribe(() => {})
  const stopTwo = two.appearance.subscribe(() => {})

  assert.equal(one.files.activeWatchers().length, 1)
  assert.equal(two.files.activeWatchers().length, 1)
  assert.equal(one.files.activeWatchers()[0].path, PATHS.currentPath)
  assert.equal(two.files.activeWatchers()[0].path, PATHS.currentPath)

  one.appearance.apply()
  two.appearance.apply()
  assert.deepEqual(one.display.css(), [COMPOSED_CSS])
  assert.deepEqual(two.display.css(), [COMPOSED_CSS_V2])
  assert.equal(one.appearance.appliedHash(), GENERATION_A)
  assert.equal(two.appearance.appliedHash(), GENERATION_B)

  stopOne()
  stopTwo()
  assert.equal(one.files.activeWatchers().length, 0)
  assert.equal(two.files.activeWatchers().length, 0)
})

test("missing direct generation falls back to verified current reads", () => {
  const { appearance, display, files } = setup()
  writeGeneration(files, GENERATION_A, { direct: false })

  const result = appearance.applyGeneration(GENERATION_A)

  assert.deepEqual(result, { status: "applied", genHash: GENERATION_A })
  assert.deepEqual(display.css(), [COMPOSED_CSS])
  assert.ok(files.reads.includes(CURRENT_CSS))
  assert.ok(files.reads.includes(CURRENT_TOKENS))
  assert.ok(!files.reads.some((path) => path.startsWith(`${DIRECT_A}/appearance`)))
})

test("a missing generation is deferred with its requested hash", () => {
  const { appearance, display, files } = setup()
  writeGeneration(files, GENERATION_B, { direct: true })
  files.remove(PATHS.manifestPath)

  const result = appearance.applyGeneration(GENERATION_A)

  assert.deepEqual(result, {
    status: "deferred",
    reason: "current generation is missing",
    genHash: GENERATION_A,
  })
  assert.equal(appearance.apply(), null)
  assert.equal(appearance.appliedHash(), null)
  assert.deepEqual(display.ops, [])
})

test("the v3 handler answers the exact applied generation, never an ok boolean", () => {
  const responses: string[] = []
  const handler = createAppearanceRefreshHandler({
    applyGeneration: (genHash) => ({ status: "applied", genHash }),
  })
  handler([APPEARANCE_REFRESH_COMMAND, GENERATION_A], (response) => responses.push(response))

  assert.equal(responses.length, 1)
  assert.deepEqual(JSON.parse(responses[0]), { applied: GENERATION_A })
  assert.doesNotMatch(responses[0], /"ok"/)
})

test("the v3 handler maps deferred and failed outcomes with the requested hash", () => {
  const responses: string[] = []
  let outcome: "deferred" | "failed" = "deferred"
  const handler = createAppearanceRefreshHandler({
    applyGeneration: (genHash) => {
      if (outcome === "deferred") {
        return { status: "deferred", reason: "pointer moved", genHash }
      }
      return { status: "failed", reason: "busy", retryable: true, genHash }
    },
  })
  const request = (): void =>
    handler([APPEARANCE_REFRESH_COMMAND, GENERATION_A], (response) => responses.push(response))

  request()
  assert.deepEqual(JSON.parse(responses[0]), {
    deferred: "pointer moved",
    genHash: GENERATION_A,
  })

  outcome = "failed"
  request()
  assert.deepEqual(JSON.parse(responses[1]), {
    failed: "busy",
    retryable: true,
    genHash: GENERATION_A,
  })
})

test("the v3 handler integrates with the real stale-pointer result", () => {
  const { appearance, display, files } = setup()
  writeGeneration(files, GENERATION_B, { direct: true })
  const responses: string[] = []
  const handler = createAppearanceRefreshHandler(appearance)
  handler([APPEARANCE_REFRESH_COMMAND, GENERATION_A], (response) => responses.push(response))

  assert.deepEqual(JSON.parse(responses[0]), {
    deferred: `current generation moved to ${GENERATION_B}`,
    genHash: GENERATION_A,
  })
  assert.deepEqual(display.ops, [])
  assert.equal(appearance.appliedHash(), null)
})

test("the v3 handler rejects malformed and v2 requests without an ok ack", () => {
  const responses: string[] = []
  const handler = createAppearanceRefreshHandler({
    applyGeneration: (genHash) => ({ status: "applied", genHash }),
  })
  const request = (argv: string[]): void =>
    handler(argv, (response) => responses.push(response))

  request(["palette-refresh", GENERATION_A])
  request([APPEARANCE_REFRESH_COMMAND])
  request([APPEARANCE_REFRESH_COMMAND, "not-a-hash"])

  assert.equal(responses.length, 3)
  for (const response of responses) {
    const parsed = JSON.parse(response) as Record<string, unknown>
    assert.equal(parsed.ok, undefined)
    assert.equal(parsed.retryable, false)
    assert.equal(typeof parsed.failed, "string")
    assert.match(String(parsed.genHash), /^[0-9a-f]{64}$/)
  }
})

test("the v3 handler runs app work once per generation and never after deferred/failed", async () => {
  const worked: string[] = []
  const responses: string[] = []
  let outcome: "applied" | "deferred" | "failed" = "deferred"
  let async = false
  const handler = createAppearanceRefreshHandler(
    { applyGeneration: (genHash) => ({ status: "applied", genHash }) },
    (genHash) => {
      worked.push(genHash)
      const result =
        outcome === "applied"
          ? { status: "applied" as const }
          : outcome === "deferred"
            ? { status: "deferred" as const, reason: "unsaved edits" }
            : { status: "failed" as const, error: "boom", retryable: true }
      return async ? Promise.resolve(result) : result
    },
  )
  const request = (): void =>
    handler([APPEARANCE_REFRESH_COMMAND, GENERATION_A], (response) => responses.push(response))

  request()
  assert.deepEqual(JSON.parse(responses[0]), {
    deferred: "unsaved edits",
    genHash: GENERATION_A,
  })
  assert.deepEqual(worked, [GENERATION_A], "deferred work is retried next trigger")

  outcome = "failed"
  request()
  assert.deepEqual(JSON.parse(responses[1]), {
    failed: "boom",
    retryable: true,
    genHash: GENERATION_A,
  })

  outcome = "applied"
  async = true
  request()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(JSON.parse(responses[2]), { applied: GENERATION_A })

  request()
  assert.deepEqual(worked, [GENERATION_A, GENERATION_A, GENERATION_A], "no rerun after applied")
  assert.equal(responses.length, 4)
})

test("the v3 handler rejects a returned v2 ok result as invalid work", async () => {
  const responses: string[] = []
  const handler = createAppearanceRefreshHandler(
    { applyGeneration: (genHash) => ({ status: "applied", genHash }) },
    (() => ({ ok: true })) as unknown as () => { status: "applied" },
  )
  handler([APPEARANCE_REFRESH_COMMAND, GENERATION_A], (response) => responses.push(response))

  assert.deepEqual(JSON.parse(responses[0]), {
    failed: "invalid appearance-refresh work result",
    retryable: false,
    genHash: GENERATION_A,
  })
})

test("the handler answers a second in-flight request with deferred busy", async () => {
  const responses: string[] = []
  let release: (() => void) | null = null
  const handler = createAppearanceRefreshHandler(
    { applyGeneration: (genHash) => ({ status: "applied", genHash }) },
    () => new Promise((resolve) => {
      release = () => resolve({ status: "applied" })
    }),
  )
  const request = (): void =>
    handler([APPEARANCE_REFRESH_COMMAND, GENERATION_A], (response) => responses.push(response))

  request()
  request()
  assert.deepEqual(JSON.parse(responses[0]), { deferred: "busy", genHash: GENERATION_A })
  assert.notEqual(release, null)
  const run = release as unknown as (() => void) | null
  run?.()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(JSON.parse(responses[1]), { applied: GENERATION_A })
})
