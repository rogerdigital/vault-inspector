# Orphan Attachment Precision Design (Milestone 1, Task 1.2)

Date: 2026-08-30
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.2)
Depends on: `docs/superpowers/specs/2026-08-30-reference-index-design.md` (merged — `ctx.referenceIndex` exists)

## Problem

The orphan-attachment scanner still rebuilds its own Markdown-only reference
state (`collectReferencedPaths` in `src/scanner/scanners/orphan-attachments.ts`)
even though every scan now carries a shared reference index
(`src/scanner/reference-index.ts`). The consequences:

- **Canvas false positives.** An attachment referenced only from a Canvas file
  node (the precision fixture's `attachments/canvas-image.png`, referenced by
  `canvas/board.canvas`) is reported as an orphan. The precision suite pins
  this as a "known false positive boundary" — this task removes it.
- **Thin evidence.** Findings carry only `lastModified`. Size, inbound
  reference status, and coverage completeness are missing, so users (and the
  CLI's automation fields) cannot judge why a file is considered unreferenced.
- **No coverage honesty.** If a `.canvas` file fails to parse, the index is
  incomplete (`coverageComplete === false`), but the scanner still emits
  normal orphan findings with delete (`trash-file`) fix actions — deletion is
  authorized on evidence the tool knows is partial.

## Goals

- Consume `ctx.referenceIndex` via `isReferenced(index, path)`; delete
  `collectReferencedPaths` and the scanner's direct
  `metadataCache`/`resolveVaultLinkTargets` dependency. Canvas-referenced
  attachments stop being orphans for free (the index records `canvas`-kind
  inbound references).
- Richer evidence per orphan finding: file size, last modification time,
  inbound reference count, and coverage completeness.
- One `unverified` coverage finding per scan when Canvas parsing is
  incomplete (`index.coverageFailures.length > 0`), summarizing ALL failures
  with a deterministic fingerprint — never one finding per failed file.
- No `fixAction` (orphan-delete eligibility) on orphan findings while
  `coverageComplete === false`.
- Orphan findings stay `candidate` — CSS, Dataview, publishing pipelines, and
  external tools remain named boundaries outside the scan.
- Recent-file severity behavior preserved: `info` within the 7-day recency
  window, `warning` otherwise.
- Precision suite inventory flips 19 → 18 lines: the
  `attachments/canvas-image.png` orphan finding disappears (the intended
  behavior change); the Canvas false-positive boundary test flips to assert
  the attachment is NOT reported.

## Non-goals (this PR)

- No change to reference *resolution* semantics — those moved into
  `buildReferenceIndex` in Task 1.1 and are covered by
  `src/tests/reference-index.test.ts`.
- No fingerprint scheme change for orphan findings: the fingerprint stays
  `generateFingerprint("orphan-attachments", path, { orphan: true })` so
  user-ignored orphan findings remain ignored after the upgrade. The new
  coverage finding gets its own fingerprint inputs (below).
- No settings changes, no CLI flag changes, no vault mutation.
- No deduplication or keep-mode work (Milestone 1.3), no deletion-impact
  previews (Milestone 2).

## Design

### Scanner consumption

```ts
const index = ctx.referenceIndex;
for (const file of ctx.allFiles) {
	if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;
	if (!isAttachment(file.path)) continue;
	if (isReferenced(index, file.path)) continue;
	// emit orphan finding
}
```

Same candidate loop as today; only the reference test changes. Because the
index is built from ALL markdown files and ALL canvas files (including notes
in ignored folders — see the Task 1.1 design), Markdown-level semantics
cannot regress, and Canvas references now count. `collectReferencedPaths`,
the `resolveVaultLinkTargets` import, and the scanner's
`metadataCache.getFileCache` traversal are deleted outright.

### Evidence shape

`Issue.evidence` is `Record<string, string | number | boolean>` — no arrays,
no nested objects. Orphan findings carry:

| Field | Type | Meaning |
|---|---|---|
| `size` | number | `file.stat.size` in bytes |
| `lastModified` | number | `file.stat.mtime` epoch ms (unchanged field) |
| `referenceCount` | number | inbound reference count — always `0` for an orphan (referenced files are skipped) |
| `coverageComplete` | boolean | whether the shared reference index saw all reference sources |

**Deliberate deviation from the roadmap wording** ("reference sources" in
evidence): an orphan has no inbound sources by definition — a file with
sources is skipped before finding construction. An always-empty string field
would be noise; `referenceCount: 0` records the same fact as a number, and
the source lists stay available in the index itself for the consumers that
actually need them (Milestone 1.3 keep decisions, Milestone 2.1 impact
previews). The finding's fingerprint does NOT include this evidence (below),
so the richer shape cannot churn fingerprints.

### Explanation updates

The old `why` ("No Markdown note references this attachment…") and caveat
("CSS, Canvas, Dataview, … outside this scan boundary") are now wrong:
Canvas IS inside the boundary. New text:

- `why`: "No note, embed, frontmatter link, or Canvas file node in the vault
  references this attachment."
- `caveat`: "CSS, Dataview, publishing pipelines, and external tools can
  reference files outside this scan boundary." (Canvas removed.)
- `nextStep`: "Review external and generated references before moving the
  file to trash." when coverage is complete; "Resolve the incomplete
  reference coverage below before moving the file to trash." when it is not.
- Classification stays `candidate` in both cases.

### Fix-action gating

`fixAction` (`trash-file`) is emitted ONLY when `index.coverageComplete`.
When coverage is incomplete the finding is still reviewable (severity,
evidence, explanation all present) but offers no destructive action. This is
the scanner-side half of the coverage gate; Milestone 2.1 hardens the
executor side.

### Coverage finding (new, `unverified`)

Emitted at most once per scan, only when
`index.coverageFailures.length > 0`:

```ts
{
	scannerId: "orphan-attachments",
	severity: "info",
	title: "Reference coverage incomplete",
	classification: "unverified",
	message: "<N> Canvas file(s) could not be parsed (<reasons>); orphan results may be incomplete",
	primaryPath: sortedFailurePaths[0],
	relatedPaths: sortedFailurePaths,
	evidence: {
		failedCount: number,
		failedPaths: "a.canvas,b.canvas",   // sorted, comma-joined (evidence values are scalars)
		reasons: "malformed-json,read-failed", // sorted unique reasons, comma-joined
	},
	explanation: describeFinding(
		"unverified",
		"Canvas reference sources could not be fully parsed, so the absence of references for some attachments is not yet trustworthy.",
		"Fix or remove the malformed Canvas file(s) listed here, then rescan.",
	),
	fingerprint: generateFingerprint("orphan-attachments", sortedFailurePaths[0], {
		coverageFailure: true,
		paths: sortedFailurePaths.join(","),
	}),
}
```

Determinism: failures are sorted by path before any string is built, so the
same failure set always yields the same fingerprint, message, and
`relatedPaths`. A different failure set yields a different fingerprint (the
ignored-fingerprints mechanism works per-symptom). `severity: "info"` matches
the existing convention for `unverified` findings (external-links request
failures). No `fixAction` — this finding describes a scan-quality problem,
not a fixable vault problem.

The scanner id stays `orphan-attachments`: the coverage gap only affects this
scanner's trustworthiness today, and reusing the id keeps it grouped under
the existing scanner section/label with no `ScannerId` union change.

### Render/export impact (honest finding)

- `src/report/render-issues.ts` — **no change needed**. The orphan summary
  ("Not referenced by any note · modified …") reads `evidence.lastModified`,
  which is unchanged. All new evidence fields render automatically because
  `renderFindingEvidence` (`src/report/render-evidence.ts`) iterates
  `Object.keys(issue.evidence).sort()`. The coverage finding needs no special
  casing: `getIssueSummary` falls through to `issue.message`, and its
  `relatedPaths` render through the standard path handling.
- `src/report/markdown-export.ts` — **one minimal addition**.
  `getMarkdownDetails` is per-scanner and would silently drop the new
  `size` field, so the `orphan-attachments` branch gains a `Size` row via
  `formatSize` (mirroring `large-files`). `referenceCount`/`coverageComplete`
  are intentionally not duplicated into prose rows: they are already visible
  in the plugin UI's evidence disclosure, and the CLI JSON exposes evidence
  verbatim; adding them to Markdown adds noise without decision value. The
  coverage finding exports fine through the generic location/message paths.

### Test strategy

- `src/tests/orphan-attachments.test.ts` is rewritten. Its link-resolution
  cases (same-name resolution, source-folder preference, alias stripping,
  the 2000-embed performance test) tested behavior that now lives in
  `buildReferenceIndex` and is already covered by
  `src/tests/reference-index.test.ts`; keeping them would require mocking the
  index instead of testing anything real. The rewritten suite injects
  hand-built `ReferenceIndex` values (plain object literals — the type is a
  structural `{ inboundByPath, canvasFiles, coverageFailures, coverageComplete }`)
  through `makeCtx({ referenceIndex })` and covers: orphan detection with the
  new evidence and fix action; skip when referenced through each index kind
  (`note-link`, `embed`, `frontmatter`, `canvas`); recency severity; ignored
  folders; non-attachments; fix-action suppression and next-step text under
  incomplete coverage; the single deduplicated `unverified` coverage finding
  (sorted paths, deterministic fingerprint, none when coverage complete).
- `src/tests/scanner-precision.test.ts`: `EXPECTED_INVENTORY` drops the
  `attachments/canvas-image.png` line (19 → 18); the "three unreferenced
  attachments" test becomes two; the known-false-positive boundary test
  flips to assert the Canvas-referenced attachment is NOT reported.
- `src/tests/scan-runner.test.ts`, CLI tests, snapshot/diff tests: untouched —
  the fixture vault's canvas parses cleanly, so no coverage finding appears
  there and only the one intentional inventory line changes.

## Verification strategy

```bash
npm test -- src/tests/orphan-attachments.test.ts src/tests/scanner-precision.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: unit suite green with the new coverage-failure cases; precision
inventory matches the 18-line expectation; full gates green.

## Risks

- **Fingerprint compatibility**: unchanged for existing orphan findings
  (`{ orphan: true }`), so ignore-lists survive. The Canvas fixture orphan's
  fingerprint simply disappears from results — that is the fix.
- **Severity counts shift for users with malformed canvases**: they gain one
  `info`/`unverified` finding and lose delete buttons on orphans until the
  canvas is fixed. Intended, and reversible by fixing the canvas file.
- **Explanation text change** (`why`/`caveat`): no test outside the rewritten
  suites pins the old wording; the flipped precision test drops the old
  `caveat`-contains-"Canvas" assertion along with the boundary it pinned.
