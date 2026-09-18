# Safe Large Report Export Design

## Problem

Vault Inspector currently generates a complete Markdown report and writes it
directly into the configured vault folder. The report expands every active
finding into a heading, interpretation fields, location, message, and
scanner-specific evidence. Report size therefore grows with both the number of
findings and the number of paths attached to those findings.

A user reported that three exported reports of approximately 3.1–3.2 MB made
Obsidian display a black screen while indexing a vault of roughly 10,000 files.
Moving only those reports outside the vault restored normal operation. The
reports are valid output; the failure occurs after Vault Inspector writes them,
when Obsidian indexes large Markdown files inside the vault.

The current export path has no byte-size check, warning, cancellation point, or
compact alternative. The fix must therefore prevent an unexpectedly large full
report from being written into the vault without an explicit user decision.

## Goals

- Measure the complete report before any folder or file is created.
- Preserve the existing export behavior for reports of 1 MiB or less.
- Warn before writing a complete report larger than 1 MiB into the vault.
- Make a compact summary the primary safe action for a large report.
- Allow an informed user to export the complete report anyway.
- Keep CLI JSON and Markdown output compatible with 0.5.0.
- Make cancellation and failures visible, deterministic, and recoverable.

## Non-goals

- Splitting a report across multiple Markdown files.
- Automatically truncating finding details.
- Adding a configurable warning threshold.
- Choosing a filesystem destination outside the vault.
- Changing report-folder settings or Obsidian indexing behavior.
- Changing scanner detection, lifecycle comparison, fingerprints, fixes, or
  CLI schemas.
- Bumping the version, tagging, publishing, or otherwise performing the 0.5.1
  release.

## Root cause

`generateMarkdownReport` builds a complete string by rendering every active
finding. `VaultInspectorPlugin.exportReport` then creates the configured report
folder and writes that string with `vault.create`. There is no policy boundary
between rendering and persistence.

The report-size growth is expected and linear in the rendered finding data. The
defect is the unconditional persistence of that potentially large Markdown
string inside the vault. Vault Inspector cannot guarantee how Obsidian indexes
such a file, so the protection must run before the first vault mutation.

## Chosen approach

Use a fixed 1 MiB preflight policy for plugin exports:

1. Generate the complete report once.
2. Measure its UTF-8 byte length.
3. If the size is at most 1 MiB, write it using the existing full-report path.
4. If the size is greater than 1 MiB, show a warning modal before creating the
   folder or file.
5. Let the user export a summary, export the complete report anyway, or cancel.

The threshold is fixed rather than configurable. This keeps the safety boundary
consistent, avoids another setting that users must understand, and leaves room
below the 3.1–3.2 MB reports associated with the observed failure.

Automatic splitting was rejected because multiple indexable Markdown files do
not remove the total indexing load and introduce naming, navigation, and cleanup
complexity. Automatic truncation was rejected because it silently discards
information and weakens report trustworthiness.

## Components

### Report policy

Create `src/report/report-export.ts` with the plugin-only policy:

- `MAX_SAFE_VAULT_REPORT_BYTES = 1024 * 1024`;
- `getUtf8ByteLength(value: string): number` using `TextEncoder`;
- `requiresLargeReportConfirmation(report: string): boolean`, which returns
  `true` only when the byte length is strictly greater than the threshold;
- `LargeReportExportDecision = "summary" | "full" | null`.

Keeping measurement and the threshold in a pure module makes the byte boundary
independent of the Obsidian UI and directly testable with ASCII, CJK, and emoji
input. Exactly 1 MiB remains on the existing no-warning path.

### Markdown generation

Extend `generateMarkdownReport` in `src/report/markdown-export.ts` with an
optional mode whose default is `"full"`. Existing callers that omit the option
must receive byte-for-byte equivalent structure to the current full report,
apart from the existing locale-dependent date value.

Summary mode renders:

- `# Vault Inspector Summary`;
- scan date, files scanned, duration, and scanners run;
- the existing severity-count table for active findings;
- a scanner-count table in `result.scannersRun` order;
- an explicit sentence that finding details are omitted from the summary.

Summary mode must not render finding titles, paths, messages, evidence,
classification, explanation, fix metadata, ignored findings, lifecycle status,
or resolved snapshots. It summarizes the same active-finding boundary used by
the existing full Markdown report.

The CLI continues calling `generateMarkdownReport(result)` without an option,
so its Markdown output remains complete and compatible.

### Warning modal

Create `src/report/export-warning-modal.ts`. The modal receives the application,
full report byte size, threshold, active finding count, and a single-use
resolver. It returns `Promise<LargeReportExportDecision>`.

The modal explains that the complete report exceeds the safe in-vault export
threshold and may make Obsidian unresponsive while indexing it. It displays the
formatted actual size, formatted threshold, and active finding count. Actions
are:

- `Cancel`, returning `null`;
- `Export full report anyway`, returning `"full"`;
- `Export summary only`, returning `"summary"` and styled as the primary
  action.

Closing the modal, pressing Escape, or otherwise invoking `onClose` returns
`null`. The resolver must settle only once so a button click followed by close
cannot overwrite the selected decision. The modal reuses the existing
confirmation-modal layout classes and Obsidian button classes; it does not add a
new visual system.

### Export orchestration

Update `VaultInspectorPlugin.exportReport` in `src/main.ts`:

1. Keep the existing requirement for a completed scan result.
2. Generate the complete report and measure it before calling
   `vault.createFolder` or `vault.create`.
3. Skip the modal for a report of 1 MiB or less.
4. Await the warning modal for a larger report.
5. Return without a vault mutation when the decision is `null`.
6. Reuse the already-generated complete string for a `"full"` decision.
7. Generate summary mode only for a `"summary"` decision.
8. Use `Vault Inspector Report <timestamp>.md` for complete output and
   `Vault Inspector Summary <timestamp>.md` for summary output.
9. Create the configured folder and then write exactly one selected file.
10. Show a success Notice that distinguishes `Report exported` from
    `Summary exported`.

Generation, modal, folder, or file errors are caught at the command boundary and
shown as `Report export failed: <message>`. A failed or cancelled export must not
show a success Notice. The existing `Run a scan first before exporting.` Notice
is unchanged.

## Data flow

```text
current ScanResult
       |
       v
generate complete Markdown
       |
       v
measure UTF-8 bytes
       |
       +-- <= 1 MiB ------------------> write complete report
       |
       `-- > 1 MiB --> warning modal
                          |-- summary --> generate summary --> write summary
                          |-- full --------------------------> write complete report
                          `-- cancel ------------------------> write nothing
```

No vault mutation occurs before the size decision completes.

## Error handling and recovery

- Missing scan result: preserve the existing Notice and return.
- Modal close or cancel: return without creating a folder or file.
- Modal exception: show one export-failure Notice and write nothing.
- Folder or file failure: show one export-failure Notice and no success Notice.
- Summary generation failure: show one export-failure Notice and do not fall
  back to the oversized complete report.
- Explicit complete export: write the complete report once; the user has
  accepted the indexing risk shown by the modal.

The plugin does not claim that 1 MiB is universally safe or that Obsidian can
never become unresponsive. It guarantees the narrower behavior under its
control: a complete report larger than the threshold is not written into the
vault without an explicit decision.

## Testing

### Pure report tests

Extend `src/tests/markdown-export.test.ts` to prove:

- the default mode retains complete finding details and current formatting;
- summary mode contains scan metadata, severity counts, and counts for every
  scanner in `scannersRun` order;
- summary mode explicitly says that details are omitted;
- summary mode excludes titles, paths, messages, evidence, explanations,
  classifications, lifecycle data, and resolved findings.

Add `src/tests/report-export.test.ts` to prove:

- UTF-8 byte measurement for ASCII, CJK, and emoji;
- exactly 1 MiB does not require confirmation;
- 1 MiB plus one byte requires confirmation.

### Modal tests

Add `src/tests/export-warning-modal.test.ts` with a minimal DOM/modal harness to
prove:

- actual size, threshold, risk explanation, and finding count are rendered;
- each button returns the specified decision;
- close and Escape semantics cancel;
- repeated click/close events settle once.

### Plugin integration tests

Extend `src/tests/main.test.ts` to prove:

- a small report bypasses the modal and writes the complete report;
- a large report opens the modal before any vault mutation;
- summary selection writes only summary content with the summary filename;
- complete selection writes the original generated string with the existing
  report filename;
- cancellation creates neither folder nor file;
- exact threshold and over-threshold behavior use UTF-8 bytes;
- modal, folder, and file failures show failure Notices without success Notices;
- a synthetic result whose full report exceeds 1 MiB cannot reach
  `vault.create` unless the modal returns `"full"`.

### Compatibility and release-boundary verification

Run the focused tests, then:

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm run test:coverage
npm pack --dry-run
```

Existing CLI JSON and Markdown compatibility tests must remain unchanged and
pass. Package contents and release assets must remain unchanged. The version is
not bumped as part of this implementation.

## Documentation

Update the README export section to state that plugin exports larger than 1 MiB
require a choice between a compact summary, an explicitly accepted complete
report, or cancellation. Document that the protection applies to files written
inside the vault and does not change CLI Markdown output.

## Acceptance criteria

- A complete report of 1 MiB or less follows the existing export path.
- A complete report larger than 1 MiB cannot be written by the plugin without
  selecting `Export full report anyway`.
- The primary large-report action writes a compact summary with no per-finding
  details.
- Cancelling or closing the modal writes nothing.
- All failures are visible and never accompanied by a false success Notice.
- CLI output and existing small-report behavior remain compatible with 0.5.0.
- Automated tests prove the byte boundary and no-mutation-before-decision rule.
