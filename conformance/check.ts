#!/usr/bin/env node
/**
 * CLI entry for `ags-platform/conformance/check`.
 *
 * App repos can make this their template-conformance gate:
 *
 *   node node_modules/ags-platform/conformance/check.ts .
 *
 * It prints PASS/FAIL plus each issue and exits 0/1 (2 for usage/IO errors).
 */

import { runAppConformanceCli } from "./app-conformance.ts";

process.exitCode = runAppConformanceCli(process.argv.slice(2));
