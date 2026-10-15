import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  name: string
  exports: Record<string, string>
}

test("the package boundary declares the entry point and subpaths", () => {
  assert.equal(pkg.name, "ags-platform")
  assert.deepEqual(Object.keys(pkg.exports).sort(), [".", "./adapters/*", "./ports/*"])
})

test("every declared export resolves to a file in the package", () => {
  const samples: Record<string, string> = {
    ".": "",
    "./ports/*": "event-client",
    "./adapters/*": "icon",
  }
  for (const [key, target] of Object.entries(pkg.exports)) {
    const sample = samples[key]
    assert.notEqual(sample, undefined, `no sample for ${key}`)
    const file = resolve(root, target.replace("*", sample))
    assert.ok(existsSync(file), `${key} -> ${file} does not exist`)
  }
})
