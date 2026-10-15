.PHONY: help test typecheck typecheck-tests bundle

help:
	@echo "test              Pure-module unit tests (node --test, stock runner)"
	@echo "typecheck-tests   Typecheck the pure test suite (stock runner)"
	@echo "typecheck         Desktop-stack typecheck (self-hosted runner, AD-23)"
	@echo "bundle            AGS bundle smoke check (desktop stack)"

# Pure tests: the ports only, no desktop stack. Runs on a stock CI runner.
# The tests import the ports by relative `.ts` path (see tests/tsconfig.tests.json);
# Node's native type stripping executes them with no build step.
test:
	node --test tests/

# Pure tests typecheck: also stock-safe (types: ["node"], no gi://, no ags).
typecheck-tests:
	@if [ ! -x node_modules/.bin/tsc ] || [ ! -d node_modules/@types/node ]; then \
		echo "==> installing typescript + @types/node (npm install --no-save, ignored by git)"; \
		npm install --no-save --no-package-lock typescript@5.9 @types/node@22 >/dev/null || exit 1; \
	fi
	@echo "==> typecheck-tests: tsc -p tests/tsconfig.tests.json"
	@npx tsc -p tests/tsconfig.tests.json && echo "    OK: 0 errors in the pure test suite"

# Desktop-stack typecheck (AD-23): needs the machine's GIR declarations and the
# ags/gnim packages. `ags types -d . -u` generates @girs/ + env.d.ts +
# tsconfig.json (all gitignored) and the node_modules links.
# Gate shape mirrors dotfiles-v3's bar-typecheck: fail only on errors in THIS
# repo's tree; tolerate and count the AGS runtime's own (/usr/share/ags/js/)
# errors, which are machine/GIR-version dependent.
typecheck:
	@if [ ! -f @girs/index.d.ts ]; then \
		echo "==> @girs/ missing: run 'ags types -d \"$(CURDIR)\" -u' first (desktop stack)"; \
		exit 1; \
	fi
	@if [ ! -x node_modules/.bin/tsc ]; then \
		echo "==> installing typescript (npm install --no-save, ignored by git)"; \
		npm install --no-save --no-package-lock typescript@5.9 >/dev/null || exit 1; \
	fi
	@mkdir -p node_modules
	@[ -e node_modules/ags ] || ln -sfn /usr/share/ags/js node_modules/ags
	@[ -e node_modules/gnim ] || ln -sfn /usr/share/ags/js/node_modules/gnim node_modules/gnim
	@echo "==> typecheck: tsc --noEmit -p tsconfig.platform.json"
	@log=$$(mktemp); \
	npx tsc --noEmit -p tsconfig.platform.json > "$$log" 2>&1; \
	ours=$$(grep 'error TS' "$$log" | grep -E "^(index\.ts|ports/|adapters/)|$(CURDIR)/" || true); \
	thirdparty=$$(grep 'error TS' "$$log" | grep -F '/usr/share/ags/js/' || true); \
	other=$$(grep 'error TS' "$$log" | grep -vE "^(index\.ts|ports/|adapters/)|$(CURDIR)/" | grep -vF '/usr/share/ags/js/' || true); \
	echo "    tolerated third-party errors (/usr/share/ags/js): $$(printf '%s\n' "$$thirdparty" | grep -c . || true)"; \
	if [ -n "$$other" ]; then \
		echo "FAIL: errors in neither this repo nor the known ags runtime:"; \
		printf '%s\n' "$$other"; rm -f "$$log"; exit 1; \
	fi; \
	if [ -n "$$ours" ]; then \
		echo "FAIL: type errors in this repo:"; \
		printf '%s\n' "$$ours"; rm -f "$$log"; exit 1; \
	fi; \
	echo "    OK: 0 errors in the ags-platform tree"; \
	rm -f "$$log"

bundle:
	@echo "TODO: ags bundle smoke check (desktop stack)"
