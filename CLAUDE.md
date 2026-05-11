# Vault Inspector

Obsidian plugin that scans a vault for maintenance problems. Read-only by design — no file mutation except exported reports.

## Commands

```bash
npm run dev       # watch mode
npm run build     # tsc + esbuild production
npm test          # vitest run
npm run test:watch
```

Always run `npm run build && npm test` before committing. CI enforces this.

## Architecture

```
src/
  main.ts                  # Plugin entry, registers scanners/views/commands
  settings/
    settings.ts            # InspectorSettings type + defaults
    settings-tab.ts        # Obsidian PluginSettingTab UI
  scanner/
    Issue.ts               # Issue, ScanResult, ScannerId types
    ScanContext.ts          # Read-only snapshot passed to scanners
    ScanRunner.ts           # Orchestrates enabled scanners
    issue-fingerprint.ts    # Deterministic issue IDs
    scanners/               # One file per scanner, pure logic
  report/
    InspectorView.ts        # ItemView — dashboard + interactions
    render-summary.ts       # Summary stats
    render-issues.ts        # Issue list with actions
    markdown-export.ts      # Report → Markdown
  utils/                    # Shared helpers (paths, file-types, hash, frontmatter-type)
  tests/                    # Unit tests per scanner
```

## Key conventions

- Scanners implement `{ id: ScannerId; scan(ctx: ScanContext): Issue[] | Promise<Issue[]> }` and are registered in `main.ts`.
- Scanner logic stays in `src/scanner/scanners/`. Keep Obsidian API coupling minimal — use `ScanContext` fields, not direct `app.*` calls.
- Each scanner gets its own commit. Don't bundle scanner work with report UI changes.
- `Issue.fingerprint` must be deterministic: same evidence + scanner ID + primary path = same fingerprint.
- Report rendering is in `src/report/`. View state lives in `ReportModel`.
- Settings live in `src/settings/settings.ts`. New settings need: type + default + ScanContext field + ScanRunner propagation + settings-tab UI.

## Git workflow

- `main` branch is protected: PR required, CI `verify` check must pass, no force push.
- Feature branches: `feat/<short-description>`, `ci/<description>`, `fix/<description>`.
- Commit messages: conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`).
- No co-author footers or AI attribution in commits.

## Release assets

`main.js`, `manifest.json`, `styles.css` — built by `npm run build`, published via GitHub Releases.
