# Vault Inspector

Scan your Obsidian vault for maintenance problems: broken links, missing attachments, orphan files, duplicate files, empty notes, tag issues, and large files.

Use it before publishing, exporting, migrating, or cleaning up a long-lived vault.

![Vault Inspector scan results](docs/images/vault-inspector-errors-orphans.gif)

## Features

- **Broken Links** — Detect wiki links, markdown links, and embeds pointing to non-existent notes or headings.
- **Orphan Attachments** — Find images, PDFs, audio/video, and archives not referenced by any note.
- **Empty Notes** — Flag notes with no meaningful content beyond frontmatter and title.
- **External Links** — Check external URLs for availability (HTTP status).
- **Duplicate Files** — Identify duplicates by name, size, and optional SHA-256 content hash.
- **Frontmatter Types** — Report properties used with inconsistent value types across notes.
- **Tag Usage** — Watch for missing or underused tags from a configurable watchlist.
- **Large Files** — Flag Markdown files and attachments exceeding configurable size thresholds.

## Install

### Community Plugins

Search **Vault Inspector** in Obsidian → Settings → Community plugins → Browse.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/rogerdigital/vault-inspector/releases) and place them in `.obsidian/plugins/vault-inspector/`.

### CLI

Install the npm package for terminal, CI, or agent workflows:

```bash
npx vault-inspector .
npx vault-inspector /path/to/vault
npx vault-inspector@0.4.2 .
npm install -g vault-inspector
vault-inspector .
```

The CLI package is separate from Obsidian's Community Plugins install path. Updating
the Obsidian plugin affects the in-app plugin; installing from npm provides the
`vault-inspector` terminal command.

## Usage

1. Open the command palette and run **Vault Inspector: Run scan**.
2. The Inspector view opens in the right sidebar.
3. Filter results by scanner or severity. Click a file path to open it.
4. Click **Select** to enter selection mode, then batch delete or ignore issues.
5. Expand **Ignored items** at the bottom to restore previously ignored issues.
6. Run **Vault Inspector: Export report** to save results as Markdown.

## CLI

Vault Inspector also exposes a read-only CLI for generated or agent-managed vaults.

Short forms:

```bash
npx vault-inspector .              # scan the current vault with the latest version
npx vault-inspector /path/to/vault # scan another vault with the latest version
npx vault-inspector@0.4.2 .        # scan with a pinned version
```

After a global install:

```bash
npm install -g vault-inspector
vault-inspector .
vault-inspector /path/to/vault
```

Local command forms:

```bash
vault-inspector /path/to/vault
vault-inspector scan /path/to/vault
vault-inspector . --format json
vault-inspector . --format markdown --output report.md
vault-inspector /path/to/vault --scanner broken-links,empty-notes
vault-inspector /path/to/vault --config vault-inspector.config.json
```

The default output format is JSON. It includes summary counts, scanners run, issues,
ignored issues, fingerprints, evidence, and available fix-action metadata so other
tools can decide what to do next.

Useful automation options:

```bash
vault-inspector /path/to/vault \
  --scanner broken-links,empty-notes \
  --severity error,warning \
  --include "notes/**" \
  --exclude "templates/**" \
  --fail-on warning

vault-inspector /path/to/vault \
  --baseline .vault-inspector-baseline.json \
  --fail-on new
```

Config files are JSON and use the same option names:

```json
{
  "scanners": ["broken-links", "empty-notes", "large-files"],
  "severity": ["error", "warning"],
  "include": ["notes/**"],
  "exclude": ["templates/**"],
  "ignoredFolders": [".trash"],
  "failOn": "warning",
  "largeMarkdownBytes": 102400
}
```

CLI flags override config file values.

JSON output has a stable top-level protocol for automation:

- `schemaVersion` — currently `1`
- `tool` — always `vault-inspector`
- `toolVersion` — package version
- `summary` — stable counts and scanner metadata
- `issues` / `ignoredIssues` — issue records with stable `scannerId`, `severity`, `primaryPath`, `relatedPaths`, `evidence`, `fingerprint`, and `fixAction` fields
- `generatedAt`, `durationMs`, titles, and messages are informational and should not be used as stable identifiers

Baseline comparison uses issue `fingerprint` values from a previous JSON report.
When `--baseline` is provided, each issue includes `isNew`, and `summary.newIssues`
counts issues not found in the baseline.

Exit codes:

- `0` — scan completed and did not match the configured `--fail-on` threshold.
- `1` — scan completed and matched the configured `--fail-on` threshold.
- `2` — invalid CLI usage or scan setup failure.

`--fail-on` accepts `any` (default), `warning`, `error`, `new`, and `none`.

CLI scan mode is read-only. `--fix` is reserved for a future explicit opt-in fix
command and currently exits with an error instead of modifying files. This keeps
automated agents from deleting or rewriting vault content unless fix execution is
implemented as a deliberate, separately documented workflow.

## Scanners

### Broken Links

Supports wiki links (`[[Note]]`), aliased links (`[[Note|Display]]`), heading links (`[[Note#Section]]`), markdown links, and embeds (`![[image.png]]`).

- `error` — unresolved link target
- `warning` — missing heading in existing note

### Orphan Attachments

Scans for attachment files not referenced by any Markdown file.

- `warning` — unreferenced file older than 24 hours
- `info` — unreferenced file modified within 24 hours
- Supported: png, jpg, jpeg, gif, webp, svg, pdf, mp3, mp4, wav, mov, zip

### Empty Notes

Flags notes that have no content beyond frontmatter and a title heading.

- `warning` — empty note

### External Links

Checks HTTP/HTTPS URLs found in notes for availability.

- `warning` — unreachable URL or non-2xx status

### Duplicate Files

Groups files by basename + extension, then by size. Files below the hash cap are verified with SHA-256.

- `warning` — hash-identical files
- `info` — same-name or same-size candidates without hash

### Frontmatter Type Inconsistencies

Reports keys used with incompatible value types across notes.

- `warning` — incompatible types (e.g., string vs array)
- `info` — string vs date-like ambiguity

### Tag Usage

Reports watched tags not present in the vault, and tags below a usage threshold.

- `info` — all tag issues

### Large Files

Flags files exceeding configurable size thresholds.

- `warning` — file above threshold

## Settings

| Setting | Default | Description |
|---|---|---|
| Enabled Scanners | All on | Toggle individual scanners |
| Enable fix actions | On | Allow batch delete of fixable issues |
| Large Markdown threshold | 100 KB | Markdown files above this size are flagged |
| Large attachment threshold | 5 MB | Attachments above this size are flagged |
| Duplicate hash cap | 1 MB | Max file size for content hash comparison |
| Empty note word threshold | 5 | Notes with fewer words (excluding frontmatter/title) are flagged |
| Watched tags | (none) | Tags to watch for missing usage |
| Low usage tag threshold | 2 | Tags below this count are flagged |
| Ignored folders | (none) | Folders excluded from all scans |
| Ignored properties | (none) | Frontmatter properties excluded from type checks |
| Report folder | Vault Inspector Reports | Folder for exported Markdown reports |

## Privacy

Vault Inspector does not make network requests except the External Links scanner, which checks URLs you explicitly have in your notes. In Obsidian this uses Obsidian's `requestUrl`; in the CLI it uses HTTP HEAD requests through the runtime `fetch` API. No vault content leaves your device beyond those link-check requests.

Vault Inspector enumerates vault files and Markdown metadata so scanners can detect
broken links, orphan attachments, duplicate files, large files, tag usage, and
frontmatter type drift. This access is local and read-only during scans.

## Limitations

- Read-only — does not modify, move, or delete vault files (except exported reports and optional batch-delete via trash).
- Broken link detection relies on Obsidian's metadata cache; links inside code blocks or comments may be missed.
- Orphan detection cannot account for references from CSS, Canvas, Dataview queries, or external tools.
- Duplicate detection above the hash cap reports candidates only (no content verification).

## Development

```bash
npm install
npm run dev       # watch mode
npm run build     # production build
npm test          # unit tests
```

## License

[MIT](LICENSE)
