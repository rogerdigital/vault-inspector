# Vault Inspector

Scan your Obsidian vault for maintenance problems: broken links, missing attachments, orphan files, duplicate files, empty notes, tag issues, and large files.

Use it before publishing, exporting, migrating, or cleaning up a long-lived vault.

![Vault Inspector scan results](docs/images/vault-inspector-errors-orphans.gif)

## Features

- **Broken Links** — Detect wiki links, markdown links, and embeds pointing to non-existent notes or headings.
- **Orphan Attachments** — Find images, PDFs, audio/video, and archives not referenced by any note.
- **Empty Notes** — Flag notes with no meaningful content beyond frontmatter and title.
- **External Links** — Optionally check external URLs for availability (HTTP status).
- **Duplicate Files** — Identify duplicates by name, size, and optional SHA-256 content hash.
- **Frontmatter Types** — Report properties used with inconsistent value types across notes.
- **Tag Usage** — Watch for missing or underused tags from a configurable watchlist.
- **Large Files** — Flag Markdown files and attachments exceeding configurable size thresholds.
- **Scan Progress** — Show scanner progress in Obsidian and optional CLI progress on stderr.

## Install

### Community Plugins

Search **Vault Inspector** in Obsidian → Settings → Community plugins → Browse.

### Manual

Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/rogerdigital/vault-inspector/releases) and place them in `.obsidian/plugins/vault-inspector/`.

### CLI

The npm package also includes a read-only terminal scanner for local vaults,
automation, and CI workflows:

```bash
npx vault-inspector /path/to/your/vault
```

Or install it globally:

```bash
npm install -g vault-inspector
vinspect /path/to/your/vault
```

The Obsidian Community Plugin release assets contain only the in-app plugin
files. The npm package additionally includes `cli.js` and exposes the
`vault-inspector` and `vinspect` commands. Starting with `0.4.10`, the npm
package is the supported CLI distribution path again.

### Agent Skill

Vault Inspector includes a read-only Agent Skill for CLI-based vault checks:

```bash
gh skill install rogerdigital/vault-inspector vault-inspector
```

It can also be installed with the skills CLI:

```bash
npx skills add rogerdigital/vault-inspector --skill vault-inspector
```

The skill teaches agents to run scans, interpret JSON/Markdown output, use
baselines, and avoid modifying vault files.

## Usage

1. Open the command palette and run **Vault Inspector: Run scan**.
2. The Inspector view opens in the right sidebar.
3. Filter results by scanner or severity. Click paths, URLs, targets, properties, or tags to jump to the relevant location.
4. Click **Select** to enter selection mode, then batch delete or ignore issues.
5. Expand **Ignored items** at the bottom to restore previously ignored issues.
6. Run **Vault Inspector: Export report** to save results as Markdown.

Scan results are selectable for copying. Duplicate file results show each file
separately, tag results show `#tag` chips, and exported Markdown reports include
scanner-specific detail fields.

## CLI

Vault Inspector also exposes a read-only CLI for generated or agent-managed vaults.

Scan a vault:

```bash
vinspect /path/to/your/vault
```

From inside a vault, `.` means the current directory:

```bash
cd /path/to/your/vault
vinspect .
```

The full command also remains available:

```bash
vault-inspector /path/to/your/vault
```

Pin a specific npm version when repeatability matters:

```bash
npx vault-inspector@0.4.11 /path/to/your/vault
```

`vault-inspector scan /path/to/vault` is also supported for scripts that prefer
an explicit subcommand.

The default output format is JSON. It includes summary counts, scanners run,
issues, ignored issues, fingerprints, evidence, and available fix-action metadata
so other tools can decide what to do next.

Common options:

```bash
vinspect . --format markdown --output report.md
vinspect . --scanner broken-links,empty-notes
vinspect . --scanner external-links
vinspect . --progress
vinspect . --config vault-inspector.config.json
```

`--progress` writes scanner progress to stderr so JSON and Markdown output on
stdout remain machine-readable.

For CI baseline checks:

```bash
vinspect . --baseline .vault-inspector-baseline.json --fail-on new
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

Settings omitted from a config file fall back to the plugin defaults — for
example, `ignoredLargeMarkdownFrontmatterKeys` already defaults to
`["excalidraw-plugin"]`, so Excalidraw drawings are ignored without any config.
If your config lists the older `"excalidraw"` key, update it to
`"excalidraw-plugin"`.

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
command and currently exits with an error instead of modifying files.

The CLI and the Obsidian plugin share scanner logic, but they are different
runtimes. The Obsidian plugin uses Obsidian metadata and UI actions; the CLI uses
a local filesystem adapter and is intended for terminal, CI, and automation
workflows.

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

Opt-in scanner for checking HTTP/HTTPS URLs found in notes for availability. It is disabled by default because it makes network requests and depends on external sites, DNS, and rate limits.

- `warning` — HTTP status 400 or higher
- `info` — timed out, failed, or skipped URL checks
- Checks Markdown links, frontmatter links, images/embeds, and bare HTTP/HTTPS URLs in note bodies.

### Duplicate Files

Groups files by basename + extension, then by size. Files below the hash cap are verified with SHA-256.

- `warning` — hash-identical files
- `info` — same-name or same-size candidates without hash

Deletion is offered only for files confirmed identical by content hash. By
default, Vault Inspector asks which file to keep. Automatic mode keeps the first
complete vault-relative path in alphabetical order. Modification time, access
time, and file size do not choose the keep file.

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
- Markdown files with configured frontmatter keys, such as Excalidraw files, can be excluded from this scanner.

Excalidraw Markdown files are ignored by default when they include the
`excalidraw-plugin` frontmatter key. If your vault uses filename-based Excalidraw
files without that frontmatter, add a path pattern such as
`**/*.excalidraw.md` to **Ignored large Markdown path patterns**.
You can use the same path patterns for other generated or workflow-specific
Markdown files, for example `index/**/*.md` or `exports/**/*.md`.

## Settings

| Setting | Default | Description |
|---|---|---|
| Enabled Scanners | All local scanners on; External Links off | Toggle individual scanners |
| Enable fix actions | On | Allow batch delete of fixable issues |
| Duplicate file keep mode | Always ask | Require a keep-file choice, or automatically keep the alphabetically first vault-relative path |
| Large Markdown threshold | 100 KB | Markdown files above this size are flagged |
| Large attachment threshold | 5 MB | Attachments above this size are flagged |
| Ignored large Markdown frontmatter keys | excalidraw-plugin | Markdown files with these frontmatter keys are excluded from large file checks |
| Ignored large Markdown path patterns | (none) | Vault-relative glob patterns excluded from large Markdown checks |
| Duplicate hash cap | 1 MB | Max file size for content hash comparison |
| Empty note word threshold | 5 | Notes with fewer words (excluding frontmatter/title) are flagged |
| Watched tags | (none) | Tags to watch for missing usage |
| Low usage tag threshold | 2 | Tags below this count are flagged |
| Ignored folders | (none) | Folders excluded from every scanner |
| Scanner-specific ignored folders | (none) | Additional folders excluded only from the selected scanner |
| Ignored properties | (none) | Frontmatter properties excluded from type checks |
| Report folder | Vault Inspector Reports | Folder for exported Markdown reports |

Global ignored folders apply to every scanner. Scanner-specific ignored folders
are additional exclusions. For example, add `syncTrash` only to Broken Links if
you want Duplicate Files to inspect that folder while broken-link checks skip it.

## Privacy

Vault Inspector does not make network requests unless the External Links scanner is enabled. That scanner checks URLs you explicitly have in your notes. In Obsidian this uses Obsidian's `requestUrl`; in the CLI it uses HTTP HEAD requests through the runtime `fetch` API. No vault content leaves your device beyond those link-check requests.

Vault Inspector enumerates vault files and Markdown metadata so scanners can detect
broken links, orphan attachments, duplicate files, large files, tag usage, and
frontmatter type drift. This access is local and read-only during scans.

## Limitations

- Read-only — does not modify, move, or delete vault files (except exported reports and optional batch-delete via trash).
- Broken link detection relies on Obsidian's metadata cache; links inside code blocks or comments may be missed.
- External link checks are opt-in and network-dependent; timeouts or blocked requests do not necessarily mean a URL is dead.
- Orphan detection cannot account for references from CSS, Canvas, Dataview queries, or external tools.
- Duplicate detection above the hash cap reports candidates only (no content verification).

## Development

```bash
npm install
npm run dev       # watch mode
npm run lint      # eslint
npm run lint:obsidian-warnings # Obsidian review warning checks
npm run build     # production build
npm test          # unit tests
npm pack --dry-run # inspect npm package contents, including cli.js
```

## License

[MIT](LICENSE)
