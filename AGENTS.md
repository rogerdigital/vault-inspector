# Vault Inspector

Obsidian plugin that scans a vault for maintenance problems. Read-only by design — no file mutation except exported reports.

- Plugin ID: `vault-inspector`
- Current version: `0.3.2`
- Min Obsidian version: `1.7.2`

## Commands

```bash
npm run dev          # watch mode
npm run build        # tsc + esbuild production
npm test             # vitest run
npm run test:watch   # vitest watch
npm run test:coverage # vitest with v8 coverage
npm pack --dry-run   # inspect npm package contents before publishing
```

Always run `npm run build && npm test` before committing. CI enforces this.

## Architecture

```
src/
  main.ts                  Plugin entry, registers scanners/views/commands
  settings/
    settings.ts            InspectorSettings type + defaults
    settings-tab.ts        Obsidian PluginSettingTab UI
  scanner/
    Issue.ts               Issue, ScanResult, ScannerId, FixAction types
    ScanContext.ts          Read-only snapshot passed to scanners
    ScanRunner.ts           Orchestrates enabled scanners
    issue-fingerprint.ts    Deterministic issue IDs
    scanners/               One file per scanner, pure logic
      broken-links.ts       Broken link detection
      duplicate-files.ts    Duplicate file detection
      empty-notes.ts        Empty note detection
      external-links.ts     External URL validation
      frontmatter-types.ts  Frontmatter type consistency
      large-files.ts        Large file detection
      orphan-attachments.ts Unreferenced attachments
      tag-usage.ts          Tag usage monitoring
  report/
    InspectorView.ts        ItemView — dashboard + interactions
    ReportModel.ts          View state management
    render-summary.ts       Summary stats
    render-issues.ts        Issue list with actions
    markdown-export.ts      Report → Markdown
  fix/
    confirm-modal.ts        Fix confirmation modal
    fix-executor.ts         Executes fix actions (trash-file, remove-link-text)
  cli/
    bin.ts                  CLI process entrypoint
    cli.ts                  CLI argument/config handling and JSON/Markdown output
    local-vault.ts          Local filesystem adapter for scanner reuse
  utils/                    Shared helpers (paths, file-types, format, hash, frontmatter-type)
  tests/                    Unit tests per scanner + utils
```

## Key conventions

- Scanners implement `{ id: ScannerId; scan(ctx: ScanContext): Issue[] | Promise<Issue[]> }` and are registered in `main.ts`.
- Scanner logic stays in `src/scanner/scanners/`. Keep Obsidian API coupling minimal — use `ScanContext` fields, not direct `app.*` calls.
- Each scanner gets its own commit. Don't bundle scanner work with report UI changes.
- `Issue.fingerprint` must be deterministic: same evidence + scanner ID + primary path = same fingerprint.
- Report rendering is in `src/report/`. View state lives in `ReportModel`.
- Settings live in `src/settings/settings.ts`. New settings need: type + default + ScanContext field + ScanRunner propagation + settings-tab UI.
- Tests live in `src/tests/`. Coverage thresholds: 40% lines, 40% functions, 50% branches.
- CLI scan mode is read-only. Keep mutation/fix execution behind a separate explicit opt-in command.
- CLI accepts both `vault-inspector <vault-path>` and `vault-inspector scan <vault-path>`; prefer the shorter form in user-facing docs.
- Stable CLI automation fields include `schemaVersion`, `toolVersion`, `summary`, issue `fingerprint`, `scannerId`, `severity`, paths, evidence, and fix-action metadata.

## Git workflow

- `main` branch is protected: PR required, CI `verify` check must pass, no force push.
- Feature branches: `feat/<short-description>`, `ci/<description>`, `fix/<description>`.
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`).
- No co-author footers or AI attribution in commits.

## Release

- Release assets: `main.js`, `manifest.json`, `styles.css`
- npm package assets: `main.js`, `cli.js`, `manifest.json`, `styles.css`, `versions.json`, `README.md`, `LICENSE`
- Release steps: bump version in `manifest.json` + `versions.json` → PR → merge → tag → push tag → CI creates release
- Before npm publish, run `npm run build && npm test && npm pack --dry-run`.
- Do NOT manually `gh release create` — CI auto-creates on tag push
