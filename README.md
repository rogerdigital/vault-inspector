# Vault Inspector

An Obsidian plugin that scans your vault for long-term maintenance problems and presents a clear, navigable report — without modifying your files.

## Scanners

### Broken Links

Detects internal links that point to non-existent notes. Supports wiki links (`[[Note]]`), aliased links (`[[Note|Display]]`), heading links (`[[Note#Section]]`), markdown links, and embeds (`![[image.png]]`).

- **Severity:** `error` for unresolved links, `warning` for missing headings.

### Orphan Attachments

Finds attachment files (images, PDFs, audio, video, archives) that are not referenced by any Markdown file.

- **Severity:** `warning` for old unreferenced files. `info` for files modified in the last 24 hours.
- **Supported extensions:** png, jpg, jpeg, gif, webp, svg, pdf, mp3, mp4, wav, mov, zip.

### Duplicate Files

Groups files by basename and extension, then by file size, to identify duplicate candidates. Files below the hash size cap are verified with SHA-256 content hash.

- **Severity:** `warning` for hash-identical files. `info` for same-name or same-size candidates without hash.

### Frontmatter Type Inconsistencies

Analyzes frontmatter property types across all notes and reports keys used with incompatible value types (e.g., `status: draft` in one note and `status: [draft]` in another).

- **Severity:** `warning` for incompatible type mixes (e.g., string vs array). `info` for string vs date-like ambiguity.

### Tag Usage

Reports tags from a user-configured watchlist that don't appear in the vault. Also reports tags with usage count below a configurable threshold.

- **Severity:** `info` for all tag issues.

### Large Files

Identifies Markdown files and attachments that exceed configurable size thresholds.

- **Severity:** `warning` for files above threshold.

## Settings

| Setting | Default | Description |
|---|---|---|
| Enabled Scanners | All on | Toggle individual scanners |
| Large Markdown threshold | 100 KB | Size above which Markdown files are flagged |
| Large attachment threshold | 5 MB | Size above which attachments are flagged |
| Duplicate hash cap | 1 MB | Max file size for content hash comparison |
| Watched tags | (none) | Tags to watch for missing usage |
| Low usage tag threshold | 2 | Tags below this count are flagged |
| Ignored folders | (none) | Folders excluded from all scans |
| Ignored properties | (none) | Frontmatter properties excluded from type checks |
| Report folder | Vault Inspector Reports | Folder for exported Markdown reports |

## Usage

1. Open the command palette and run **Vault Inspector: Run scan**.
2. The Inspector view opens in the right sidebar.
3. Browse results grouped by scanner, filtered by severity.
4. Click a file path to open it. Right-click to copy the path.
5. Click **Ignore** to suppress a specific issue in future scans.
6. Run **Vault Inspector: Export report** to save results as a Markdown file.

## Privacy

Vault Inspector does not make network requests. It reads vault files using Obsidian APIs and stores settings locally. No data leaves your device.

## Limitations

- The plugin is read-only. It does not modify, move, or delete any vault files (except for exported Markdown reports).
- Broken link detection relies on Obsidian's metadata cache, which may not cover links inside code blocks or comments.
- Orphan attachment detection cannot account for files referenced by CSS, Canvas, Dataview queries, or external tools.
- Duplicate detection uses name, size, and optional content hash. Files above the hash cap are reported as candidates only.

## Install

### Manual

Clone or copy this repository into your vault's `.obsidian/plugins/vault-inspector/` directory, then enable it in Obsidian settings.

### From Release

Download `main.js`, `manifest.json`, and `styles.css` from the latest release and place them in `.obsidian/plugins/vault-inspector/`.

## Development

```bash
npm install
npm run dev       # watch mode with sourcemaps
npm run build     # production build
npm test          # run unit tests
```

## License

MIT
