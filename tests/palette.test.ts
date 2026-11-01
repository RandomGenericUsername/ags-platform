import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  PALETTE_V1_ROLES,
  PALETTE_VERSION,
  PaletteParseError,
  missingPaletteRoles,
  paletteCssVariable,
  parsePaletteYaml,
  renderPaletteCss,
} from "../ports/palette.ts"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const FIXTURE = resolve(root, "tests/fixtures/colors.yaml")

test("a palette.v1 fixture parses every declared role, including on_backdrop", () => {
  const palette = parsePaletteYaml(readFileSync(FIXTURE, "utf8"), FIXTURE)

  assert.equal(palette.version, PALETTE_VERSION)
  assert.equal(palette.version, "1")
  assert.equal(PALETTE_V1_ROLES.length, 51)
  assert.equal(PALETTE_V1_ROLES.at(-1), "on_backdrop")

  for (const role of PALETTE_V1_ROLES) {
    assert.equal(palette.roles[role], "#123456", `missing or wrong role ${role}`)
  }
  assert.equal(palette.roles.on_backdrop, "#123456")

  // Additive producer roles are preserved; the legacy list is not a role map.
  assert.equal(palette.roles.accent, "#abcdef")
  assert.equal(palette.roles.warning, "#fedcba")
  assert.equal(palette.roles.cursor, "#010203")
  assert.equal(palette.roles["0"], undefined)
  assert.equal(palette.roles.colors, undefined)
  assert.equal(Object.keys(palette.roles).length, 51 + 3)

  assert.deepEqual(missingPaletteRoles(palette), [])
  assert.ok(Object.isFrozen(palette.roles), "the role map must be immutable")
})

test("quoted, unquoted and commented hex scalars all parse", () => {
  const palette = parsePaletteYaml(
    [
      "# leading comment",
      "primary: #112233 # unquoted with a comment",
      "secondary: '#445566'",
      'tertiary: "#778899" # double-quoted with a comment',
      "on_primary: '#abc'",
      "on_secondary: \"#a1b2c3d4\"",
    ].join("\n"),
    "inline.yaml",
  )
  assert.deepEqual(palette.roles, {
    primary: "#112233",
    secondary: "#445566",
    tertiary: "#778899",
    on_primary: "#abc",
    on_secondary: "#a1b2c3d4",
  })
})

test("the version scalar defaults to palette.v1 and an additive override is honoured", () => {
  assert.equal(parsePaletteYaml("primary: '#123456'\n").version, "1")
  assert.equal(parsePaletteYaml("version: 2\nprimary: '#123456'\n").version, "2")
})

test("malformed input fails clearly, naming the artifact and line", () => {
  const cases: Array<{ text: string; message: RegExp }> = [
    { text: 'primary: "not-a-hex"\n', message: /inline\.yaml:1: role "primary" has invalid value/ },
    { text: 'primary: "#123456"\nprimary: "#654321"\n', message: /inline\.yaml:2: duplicate role "primary"/ },
    { text: 'primary: "#123456"\n  stray: "#000000"\n', message: /inline\.yaml:2: unexpected indented line/ },
    { text: 'primary: "#123456\n', message: /inline\.yaml:1: "primary" has no readable scalar value/ },
    { text: 'nested:\n  primary: "#123456"\n', message: /inline\.yaml:1: "nested" has no readable scalar value/ },
    { text: "# only comments\n", message: /inline\.yaml: no palette roles found/ },
    { text: 'primary "#123456"\n', message: /inline\.yaml:1: not a top-level/ },
  ]

  for (const item of cases) {
    assert.throws(
      () => parsePaletteYaml(item.text, "inline.yaml"),
      (error: unknown) => {
        assert.ok(error instanceof PaletteParseError, `expected PaletteParseError, got ${String(error)}`)
        assert.equal(error.source, "inline.yaml")
        assert.match(error.message, item.message)
        return true
      },
      item.text,
    )
  }
})

test("the role CSS projection is one @define-color per declared role", () => {
  const palette = parsePaletteYaml(
    "version: 1\nprimary: '#112233'\non_backdrop: '#445566'\n",
    "inline.yaml",
  )
  assert.equal(
    renderPaletteCss(palette),
    [
      "/* palette.v1 role tokens (theme provider) */",
      "@define-color primary #112233;",
      "@define-color on_backdrop #445566;",
      "",
    ].join("\n"),
  )
})

test("the documented CSS convention is the bare @role reference", () => {
  assert.equal(paletteCssVariable("primary"), "@primary")
  assert.equal(paletteCssVariable("on_backdrop"), "@on_backdrop")
})

test("missingPaletteRoles reports renamed/removed vocabulary roles only", () => {
  const palette = parsePaletteYaml("primary: '#112233'\n", "inline.yaml")
  const missing = missingPaletteRoles(palette)
  assert.equal(missing.length, 50)
  assert.ok(missing.includes("on_backdrop"))
  assert.ok(!missing.includes("primary"))
})
