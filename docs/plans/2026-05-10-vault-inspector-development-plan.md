# Vault Inspector Development Plan

## 1. Positioning

**Plugin name:** Vault Inspector

**One-line goal:** Scan an Obsidian vault for long-term maintenance problems and present a clear, navigable report without modifying user files by default.

**Target users:**

- Users with long-lived vaults that have accumulated broken links, unused attachments, inconsistent properties, and stale tags.
- Teams or power users who need repeatable vault hygiene checks.
- Users who want confidence before syncing, publishing, archiving, or reorganizing a vault.

**Core product principle:** Detection quality comes before repair power. The first public release should be read-only except for plugin settings and exported reports.

## 2. Relationship To `obsidian-releases`

Vault Inspector should be developed in its own plugin repository. This `obsidian-releases` repository is only used for eventual community plugin listing:

- Add a final entry to `community-plugins.json`.
- Use `id`: `vault-inspector`.
- Make sure GitHub release assets include `main.js`, `manifest.json`, and `styles.css` if present.

## 3. MVP Scope

### Included In v0.1

Six scanners:

1. Broken internal links
   - `[[Wiki links]]`
   - `[[Note#Heading]]`
   - `[[Note|Alias]]`
   - Markdown links to vault files
   - Embedded links such as `![[image.png]]`
2. Orphan attachments
   - Files in attachment-like extensions with no inbound references.
   - Initial extensions: `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`, `pdf`, `mp3`, `mp4`, `wav`, `mov`, `zip`.
3. Duplicate files
   - Same path basename and extension.
   - Same file size.
   - Optional content hash for files below a configurable size cap.
4. Frontmatter type inconsistencies
   - Same property key used with incompatible value types.
   - Example: `status: draft` in one note and `status: [draft]` in another.
5. Unused tags
   - Tags seen historically are hard to infer, so v0.1 defines "unused" as tags configured in a user-maintained watchlist but not present in the vault.
   - Also report low-usage tags below a configurable threshold.
6. Large files
   - Files above a configurable size threshold.
   - Separate Markdown files from binary attachments.

Report features:

- Dashboard summary with counts by severity.
- Issue list grouped by scanner.
- Click issue to open related file.
- Copy issue path.
- Export report as Markdown.
- Ignore issue by stable fingerprint.
- Re-run scan command.

### Explicitly Out Of v0.1

- Automatic deletion of orphan attachments.
- Automatic link rewrites.
- Automatic frontmatter migrations.
- Whole-vault destructive cleanup.
- Cloud sync integration.
- Git operations.
- Background daemon scanning.

## 4. Why v0.1 Is Read-Only

The scanner touches user knowledge bases where mistakes are costly:

- An "orphan" attachment may be referenced by CSS, Canvas, Dataview, external publishing tools, or non-Markdown workflows.
- A duplicate file may be intentionally duplicated in different project folders.
- A frontmatter "type error" may be valid if the user intentionally mixes single-value and multi-value fields.
- Tag usefulness is contextual.

Therefore the first release should prove detection quality before adding repairs. The repair roadmap starts with previewed, one-at-a-time actions in v0.2.

## 5. Architecture

### Obsidian APIs To Use

- `Plugin` for lifecycle.
- `ItemView` for the report dashboard.
- `Vault` for file access.
- `MetadataCache` for resolved links, unresolved links, embeds, frontmatter, tags, headings.
- `TFile` for file metadata and opening files.
- `Notice` for short status feedback.
- `PluginSettingTab` for thresholds and scanner toggles.

Reference docs:

- Obsidian plugin development: https://docs.obsidian.md/Plugins/Getting%20started/Build%20a%20plugin
- Obsidian plugin publishing: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- Obsidian developer policies: https://docs.obsidian.md/Developer+policies

### Proposed File Structure

```text
vault-inspector/
  manifest.json
  package.json
  tsconfig.json
  esbuild.config.mjs
  src/
    main.ts
    settings/
      settings.ts
      settings-tab.ts
    scanner/
      ScanRunner.ts
      ScanContext.ts
      Issue.ts
      issue-fingerprint.ts
      scanners/
        broken-links.ts
        orphan-attachments.ts
        duplicate-files.ts
        frontmatter-types.ts
        tag-usage.ts
        large-files.ts
    report/
      InspectorView.ts
      report-model.ts
      render-summary.ts
      render-issues.ts
      markdown-export.ts
    utils/
      file-types.ts
      frontmatter-type.ts
      hash.ts
      paths.ts
    tests/
      broken-links.test.ts
      orphan-attachments.test.ts
      duplicate-files.test.ts
      frontmatter-types.test.ts
      tag-usage.test.ts
      large-files.test.ts
  styles.css
  README.md
  LICENSE
```

### Module Responsibilities

- `ScanRunner.ts`: orchestrates enabled scanners, progress, cancellation, and result aggregation.
- `ScanContext.ts`: snapshot of files, metadata, settings, and ignore list.
- `Issue.ts`: shared issue shape and severity model.
- `issue-fingerprint.ts`: stable IDs for ignored issues.
- Individual scanner files: pure scanner logic with minimal Obsidian coupling.
- `InspectorView.ts`: report view lifecycle and user interactions.
- `markdown-export.ts`: generate a portable Markdown report.
- `hash.ts`: size-capped hash helper for duplicate detection.

## 6. Data Model

```ts
type InspectorSettings = {
  enabledScanners: Record<ScannerId, boolean>;
  largeMarkdownBytes: number;
  largeAttachmentBytes: number;
  duplicateHashMaxBytes: number;
  lowUsageTagThreshold: number;
  watchedTags: string[];
  ignoredIssueFingerprints: string[];
};

type ScannerId =
  | "broken-links"
  | "orphan-attachments"
  | "duplicate-files"
  | "frontmatter-types"
  | "tag-usage"
  | "large-files";

type IssueSeverity = "info" | "warning" | "error";

type Issue = {
  scannerId: ScannerId;
  severity: IssueSeverity;
  title: string;
  message: string;
  primaryPath?: string;
  relatedPaths: string[];
  evidence: Record<string, string | number | boolean>;
  fingerprint: string;
};

type ScanResult = {
  startedAt: number;
  finishedAt: number;
  issues: Issue[];
  filesScanned: number;
  scannersRun: ScannerId[];
};
```

## 7. Scanner Definitions

### Broken Links

Inputs:

- Markdown files.
- `MetadataCache.resolvedLinks`.
- `MetadataCache.unresolvedLinks`.
- File path index.

Rules:

- Report unresolved links from metadata cache.
- Resolve wiki aliases and heading links only to the extent metadata makes reliable.
- Treat links to non-Markdown attachments as valid if the target path exists.

Severity:

- `error` for unresolved internal note/file links.
- `warning` for heading links where note exists but heading is missing, if heading verification is implemented.

### Orphan Attachments

Inputs:

- All files.
- Attachment extension list.
- Link/embed reference index.

Rules:

- Build a set of normalized referenced paths from resolved links and embeds.
- Report attachment files not referenced by Markdown metadata.
- Exclude files under user-configured ignored folders.

Severity:

- `warning` by default.
- `info` for files modified in the last 24 hours to avoid flagging newly added files too aggressively.

### Duplicate Files

Inputs:

- All files.
- File stat size.
- Optional file content for hash.

Rules:

- Group by normalized basename and extension for name duplicates.
- Group by byte size for size duplicates.
- Hash only files below `duplicateHashMaxBytes`.
- Report hash-identical files as stronger duplicate candidates.

Severity:

- `warning` for hash-identical files.
- `info` for same-name or same-size candidates.

### Frontmatter Type Inconsistencies

Inputs:

- Markdown frontmatter from metadata cache.

Rules:

- Infer shallow types:
  - string
  - number
  - boolean
  - date-like string
  - array
  - object
  - null
- For each property key, count types across files.
- Report keys with more than one dominant type unless ignored.

Severity:

- `warning` for mixed scalar/array/object.
- `info` for string/date-like ambiguity.

### Tag Usage

Inputs:

- Tags from metadata cache.
- `watchedTags` from settings.

Rules:

- Count tag occurrences.
- Report watched tags that do not appear.
- Report tags below `lowUsageTagThreshold`.
- Do not claim a tag is globally "unused" unless it comes from the watchlist.

Severity:

- `info`.

### Large Files

Inputs:

- All files.
- File stat size.

Rules:

- Markdown files use `largeMarkdownBytes`.
- Attachments use `largeAttachmentBytes`.
- Report largest files first.

Severity:

- `warning` for files above threshold.

## 8. UX Flow

1. User opens command `Vault Inspector: Run scan`.
2. Plugin opens Inspector view and shows progress.
3. Scan runner creates context snapshot.
4. Enabled scanners run.
5. Dashboard shows:
   - total issues
   - errors
   - warnings
   - info
   - files scanned
   - scan duration
6. User filters report by scanner/severity.
7. User clicks an issue to open the file.
8. User can ignore a specific issue.
9. User can export report as Markdown.

## 9. Development Milestones

### Milestone 0: Repository Bootstrap

Goal: create a minimal, testable plugin.

Tasks:

- Scaffold official Obsidian plugin structure.
- Add test runner for pure scanner modules.
- Add `manifest.json`:
  - `id`: `vault-inspector`
  - `name`: `Vault Inspector`
  - `version`: `0.1.0`
- Add README and license.

Commit:

```bash
git commit -m "chore: scaffold vault inspector plugin"
```

Verification:

- `npm install`
- `npm run build`
- Plugin loads in a test vault.

### Milestone 1: Shared Scan Model

Goal: define stable scanner contracts before implementing checks.

Tasks:

- Add `ScannerId`, `Issue`, `ScanResult`, `ScanContext`.
- Add fingerprint generation.
- Add default settings.
- Add tests for fingerprint stability.

Commit:

```bash
git commit -m "feat: add vault inspection scan model"
```

Verification:

- Unit test proves same issue evidence produces same fingerprint.
- Changing path or scanner ID changes fingerprint.

### Milestone 2: Report View Shell

Goal: create the user-facing dashboard before scanners are complete.

Tasks:

- Register Inspector view.
- Add command `Run scan`.
- Render empty summary state.
- Render static scanner sections with zero counts.
- Add basic styles.

Commit:

```bash
git commit -m "feat: add vault inspector report view"
```

Verification:

- Command opens the view.
- Empty state is clear.
- Plugin unload cleans up view registration.

### Milestone 3: Broken Link Scanner

Goal: catch the most obvious vault health issue first.

Tasks:

- Build file path index.
- Read unresolved links from metadata cache.
- Convert unresolved entries into `Issue` objects.
- Add tests with synthetic metadata.
- Render broken-link issues.

Commit:

```bash
git commit -m "feat: detect broken internal links"
```

Verification:

- Test vault with a known missing `[[Note]]` reports one issue.
- Existing links are not reported.
- Aliased links do not produce duplicate issues.

### Milestone 4: Large File Scanner

Goal: add a simple, reliable scanner with clear value.

Tasks:

- Implement size threshold settings.
- Scan all files for size.
- Separate Markdown and attachments.
- Sort largest first.
- Add tests.

Commit:

```bash
git commit -m "feat: detect large vault files"
```

Verification:

- Test vault with one oversized file reports it.
- Threshold changes affect results after re-scan.

### Milestone 5: Orphan Attachment Scanner

Goal: identify likely unused attachments conservatively.

Tasks:

- Define attachment extension list.
- Build referenced-path set.
- Scan attachment files not in referenced set.
- Add recent-file downgrade to `info`.
- Add ignored folders setting.
- Add tests for linked and unlinked attachments.

Commit:

```bash
git commit -m "feat: detect orphan attachments"
```

Verification:

- Referenced image is not reported.
- Unreferenced image is reported.
- File in ignored folder is not reported.

### Milestone 6: Duplicate File Scanner

Goal: identify duplicate candidates without expensive full-vault hashing.

Tasks:

- Group by basename and extension.
- Group by file size.
- Hash files under size cap.
- Report hash-identical groups.
- Add tests for same-name, same-size, and hash-identical cases.

Commit:

```bash
git commit -m "feat: detect duplicate file candidates"
```

Verification:

- Two identical small files are reported as hash duplicates.
- Two same-size files with different content are not marked hash-identical.
- Files above hash cap are reported only as candidates.

### Milestone 7: Frontmatter Type Scanner

Goal: detect property schema drift.

Tasks:

- Implement shallow type inference.
- Aggregate property key usage.
- Report keys with mixed types.
- Add ignored property setting.
- Add tests for scalar/array/date-like cases.

Commit:

```bash
git commit -m "feat: detect frontmatter type drift"
```

Verification:

- `status: draft` and `status: [draft]` produce one warning.
- Consistent property types produce no issue.

### Milestone 8: Tag Usage Scanner

Goal: add conservative tag hygiene without claiming false certainty.

Tasks:

- Count tag usage from metadata.
- Add watched tags setting.
- Add low-usage threshold setting.
- Report missing watched tags and low-usage tags.
- Add tests.

Commit:

```bash
git commit -m "feat: report watched and low-usage tags"
```

Verification:

- Watched missing tag is reported.
- Existing watched tag is not reported as missing.
- Low-usage threshold behaves predictably.

### Milestone 9: Report Interactions

Goal: make results actionable without mutating files.

Tasks:

- Add scanner/severity filters.
- Add click-to-open file.
- Add copy path command.
- Add ignore issue action.
- Persist ignored fingerprints.
- Add "show ignored" toggle.

Commit:

```bash
git commit -m "feat: add vault inspection report actions"
```

Verification:

- Ignored issue disappears after re-scan.
- "Show ignored" reveals ignored issue.
- Clicking an issue opens the expected file.

### Milestone 10: Markdown Export

Goal: let users keep and share audit reports.

Tasks:

- Generate Markdown report with summary and issue tables.
- Add command and button to export.
- Write report into a configurable folder, default `Vault Inspector Reports`.
- Avoid overwriting existing reports by timestamping filenames.

Commit:

```bash
git commit -m "feat: export vault inspection reports"
```

Verification:

- Export creates a Markdown file.
- Report opens in Obsidian.
- Paths and issue counts match the dashboard.

### Milestone 11: Release Readiness

Goal: prepare for community submission.

Tasks:

- README with screenshots, exact scanner definitions, limitations, and privacy note.
- Add policy note: no network access, no file modification by default.
- Add manual QA checklist.
- Build release assets.

Commit:

```bash
git commit -m "docs: prepare vault inspector release"
```

Verification:

- Install release assets into a clean vault.
- Run all scanners.
- Confirm plugin makes no content changes unless exporting report.

## 10. Testing Strategy

### Unit Tests

- Fingerprint stability.
- Link normalization.
- Orphan attachment detection.
- Duplicate grouping and hash cap.
- Frontmatter type inference.
- Tag counting.
- Large file thresholding.

### Manual Vault Tests

- Empty vault.
- Small synthetic vault with known issues.
- Real large vault.
- Vault with Canvas files.
- Vault with attachments referenced by Markdown embeds.
- Vault with frontmatter arrays and date strings.

### Performance Tests

- 1,000 Markdown files.
- 10,000 mixed files if available.
- Duplicate scanner with hash cap enabled and disabled.

## 11. Recommended Commit Sequence

1. `chore: scaffold vault inspector plugin`
2. `feat: add vault inspection scan model`
3. `feat: add vault inspector report view`
4. `feat: detect broken internal links`
5. `feat: detect large vault files`
6. `feat: detect orphan attachments`
7. `feat: detect duplicate file candidates`
8. `feat: detect frontmatter type drift`
9. `feat: report watched and low-usage tags`
10. `feat: add vault inspection report actions`
11. `feat: export vault inspection reports`
12. `docs: prepare vault inspector release`

Each scanner should be its own commit. Do not merge scanner work with report UI changes unless the report change is strictly required to display that scanner's result.

## 12. Repair Roadmap

### v0.2: Confirmed Single-Issue Repairs

- Fix one broken link by choosing a target file.
- Move one orphan attachment to a review folder.
- Normalize one frontmatter property in one file.

Requirements:

- Preview exact diff before write.
- User confirms every mutation.
- Use Obsidian vault APIs for writes.

### v0.3: Batch Repairs With Dry Run

- Batch move orphan attachments.
- Batch rewrite selected broken links.
- Batch normalize frontmatter type.

Requirements:

- Dry-run report.
- Backup note or generated rollback report.
- Clear success/failure summary.

### v0.4: Scheduled Audits

- Optional scan on startup.
- Optional weekly reminders.
- No background file mutation.

Do not add automatic repair until the scanner false-positive rate is acceptably low.
