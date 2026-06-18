# Restore CLI Support In 0.4.10

## 1. Goal

Release `0.4.10` with both of these properties:

- The npm package provides terminal commands again: `vault-inspector` and `vinspect`.
- Obsidian Community Plugin warning checks remain clean by keeping Node-only CLI code outside the Obsidian plugin review surface.

The direct design is to keep one shared scanner core, two runtime adapters, and two distribution surfaces:

- Obsidian plugin runtime: `main.js`, `manifest.json`, `styles.css`.
- npm runtime: plugin assets plus `cli.js` and `package.json` `bin` metadata.

## 2. Problem

Version `0.4.9` removed the CLI implementation to eliminate Obsidian warning checks caused by Node APIs and runtime `fetch`. That solved the review-warning symptom but removed a real npm use case:

- `npx vault-inspector /path/to/vault`
- `vault-inspector /path/to/vault`
- `vinspect /path/to/vault`

The root issue is not that CLI code exists. The root issue is that CLI code was treated as part of the Obsidian warning surface. CLI code legitimately needs Node APIs, local filesystem access, process IO, and runtime `fetch`; plugin code should continue to use Obsidian-safe APIs such as `requestUrl` and `window` timers.

## 3. Non-Goals

- Do not add write/fix behavior to the CLI.
- Do not include `cli.js` in GitHub Release assets for Obsidian Community Plugin installation.
- Do not relax Obsidian warning rules for plugin code.
- Do not split the repository into a monorepo for this release.
- Do not change scanner behavior beyond what is required to restore CLI compatibility.

## 4. Target Architecture

```text
src/
  scanner/                  Shared scanner contracts and pure scanner logic
  report/                   Shared Markdown export logic
  settings/                 Shared settings defaults and plugin settings UI
  main.ts                   Obsidian plugin entrypoint
  cli/
    bin.ts                  Node process entrypoint
    cli.ts                  CLI argument parsing, config, output, exit codes
    local-vault.ts          Local filesystem adapter that emulates the Obsidian vault/cache shape
    version.ts              CLI protocol version
```

Runtime boundaries:

- `src/main.ts` creates `ScanRunner` with Obsidian `requestUrl` and `window` timers.
- `src/cli/cli.ts` creates `ScanRunner` with Node/runtime `fetch` and Node timers.
- `src/scanner/**` should not import Node modules directly.
- `src/cli/**` may import Node modules and should be excluded from Obsidian warning lint.

## 5. Implementation Plan

### Step 1: Add CLI Distribution Contract Tests

Add focused tests that fail on `0.4.9` and pass only when the npm CLI surface exists:

- `package.json` has `bin.vault-inspector = "cli.js"`.
- `package.json` has `bin.vinspect = "cli.js"`.
- `package.json.files` includes `cli.js`.
- `src/cli/bin.ts` exists.
- `esbuild.config.mjs` builds `src/cli/bin.ts` to `cli.js` in production mode.

Expected red result on `0.4.9`:

- `pkg.bin` is missing.
- `src/cli/bin.ts` is missing.
- `esbuild.config.mjs` does not build `cli.js`.

### Step 2: Restore CLI Runtime Code

Restore the CLI files from the last version that still had CLI support, then adapt them to current shared contracts:

- `src/cli/bin.ts`
- `src/cli/cli.ts`
- `src/cli/local-vault.ts`
- `src/cli/version.ts`

Required compatibility checks:

- `ScanContext` fields added after the CLI removal must be populated through `DEFAULT_SETTINGS` or CLI config.
- Large Markdown ignore settings must work in CLI scans:
  - `ignoredLargeMarkdownFrontmatterKeys`
  - `ignoredLargeMarkdownPathPatterns`
- External link scanning in CLI must use the CLI-provided `requestUrl` adapter, not plugin `requestUrl`.
- CLI timer injection must use Node timers; plugin timer injection must keep `window` timers.

### Step 3: Restore npm CLI Package Metadata

Update `package.json`:

- Set version to `0.4.10`.
- Add:

```json
"bin": {
  "vault-inspector": "cli.js",
  "vinspect": "cli.js"
}
```

- Add `cli.js` to `files`.
- Keep `main` as `main.js`.

Run npm lockfile update so `package-lock.json` matches `0.4.10` and package metadata.

### Step 4: Restore Production CLI Build

Update `esbuild.config.mjs`:

- Keep plugin build entrypoint as `src/main.ts -> main.js`.
- Add a production-only CLI bundle:
  - entrypoint: `src/cli/bin.ts`
  - outfile: `cli.js`
  - platform: `node`
  - format: `cjs`
  - target: `node18`
  - shebang banner: `#!/usr/bin/env node`

Watch mode should continue to watch only the Obsidian plugin entrypoint unless there is a clear need to watch CLI too.

### Step 5: Keep Obsidian Warning Lint Scoped To Plugin Code

Update `lint:obsidian-warnings` so it excludes CLI code:

```bash
eslint "src/**/*.ts" --ignore-pattern "src/tests/**" --ignore-pattern "src/cli/**" ...
```

Keep normal `npm run lint` over the repository. CLI-specific overrides in `eslint.config.mjs` may allow Node modules, process globals, and runtime `fetch` only under `src/cli/**`.

This preserves the real community-plugin guarantee:

- Plugin code is checked against Obsidian warning rules.
- CLI code is not falsely judged as Obsidian runtime code.

### Step 6: Restore User Documentation

Update `README.md`:

- Reintroduce CLI install and usage examples.
- Document the difference between GitHub Release assets and npm package assets.
- Keep CLI read-only.
- Keep `--fix` documented as reserved/unavailable.
- Document JSON output protocol and exit codes if restored CLI behavior supports them.

Update `AGENTS.md`:

- Re-add `src/cli` architecture notes.
- Re-add CLI conventions.
- Record that Obsidian warning lint must exclude `src/cli/**`.
- Re-add `cli.js` to npm package assets while keeping GitHub Release assets to plugin files only.

### Step 7: Version 0.4.10

Update:

- `package.json`
- `package-lock.json`
- `manifest.json`
- `versions.json`
- `src/cli/version.ts`

Expected versions:

- npm package version: `0.4.10`
- plugin manifest version: `0.4.10`
- CLI `toolVersion`: `0.4.10`
- `versions.json["0.4.10"] = "1.7.2"`

## 6. Verification Plan

Run these checks before committing implementation:

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm pack --dry-run
```

Additional CLI-specific checks:

```bash
node cli.js --help
node cli.js . --scanner empty-notes --format json
node cli.js . --format markdown --output /tmp/vault-inspector-report.md
```

Expected verification results:

- `npm run lint` passes.
- `npm run lint:obsidian-warnings` passes while excluding `src/cli/**`.
- `npm run build` emits both `main.js` and `cli.js`.
- `npm test` passes, including CLI package contract tests.
- `npm pack --dry-run` lists `cli.js` and does not list `src/cli/**`.
- Obsidian release workflow still uploads only `main.js`, `manifest.json`, and `styles.css`.
- CLI JSON output includes `toolVersion: "0.4.10"`.

## 7. Release Plan

Preferred release path:

1. Merge this plan to `main`.
2. Implement the code changes on a feature branch.
3. Run the full verification plan.
4. Commit with a conventional commit message.
5. Push the implementation branch.
6. Open a PR against `main`.
7. Merge after CI passes.
8. Tag `0.4.10` from `main`.
9. Push the tag so GitHub Actions creates the Obsidian release.
10. Run `npm publish` only after `npm pack --dry-run` confirms the npm package contents.

If branch protection prevents direct merge or tag push, stop at the blocked step and report the exact remote error.

## 8. Rollback Plan

If the restored CLI causes release or warning-check failures:

- Keep plugin code and release assets unchanged.
- Revert only the CLI package/build changes, not unrelated scanner fixes.
- Leave a note in the PR explaining which verification failed.
- Do not publish `0.4.10` to npm until both plugin checks and CLI package checks pass.

If npm publish succeeds but Obsidian release fails:

- Do not republish the same npm version.
- Fix the release issue in `0.4.11`.
- Keep npm release notes explicit about the affected release state.

## 9. Acceptance Criteria

The task is complete only when all are true:

- `main` contains this development plan.
- `0.4.10` implementation restores `vault-inspector` and `vinspect` terminal commands.
- Obsidian warning lint passes without scanning `src/cli/**`.
- Production build creates both plugin and CLI bundles.
- npm package contains `cli.js`.
- GitHub Release assets remain plugin-only.
- `0.4.10` is published through the agreed release path, or a precise permission/protection blocker is reported.
