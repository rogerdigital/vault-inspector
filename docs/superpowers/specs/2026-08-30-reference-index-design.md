# Shared Reference Index Design (Milestone 1, Task 1.1)

Date: 2026-08-30
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.1)

## Problem

Four consumers need to know "what references what" in a vault, and today each
builds its own partial answer:

- the orphan-attachment scanner rebuilds Markdown-only reference state per scan
  (`collectReferencedPaths`), which is why Canvas-referenced attachments are
  false positives;
- duplicate-file keep decisions (Milestone 1.3) need inbound reference counts;
- deletion-impact previews (Milestone 2) need to show what breaks when a file
  is trashed;
- the CLI and the plugin must answer all of these with identical semantics.

One shared reference model, built once per scan, removes the divergence and
gives Milestone 1's scanner refinements a single source of truth.

## Goals

- A pure module `src/scanner/reference-index.ts` that builds, from a
  `ScanContext`, a per-vault-path inbound reference table with counts, source
  kinds, and source paths.
- Coverage of all reference forms the product claims to support: Wiki Links,
  Markdown links, embeds, frontmatter links (via `metadataCache` file caches),
  and Obsidian Canvas `file` nodes (via direct `.canvas` JSON reading).
- Malformed or unreadable Canvas data recorded as structured coverage failures
  that mark the index incomplete without failing the scan.
- `ScanRunner` builds the index exactly once per scan and exposes it through
  `ScanContext`.
- Identical semantics for the Obsidian plugin and the `vinspect` CLI (both
  provide `metadataCache.getFirstLinkpathDest`; the CLI adapter aligns with
  Obsidian link semantics since PR #125).
- Scan duration stays within 15% of the Milestone 0 benchmark baseline.

## Non-goals (this PR)

- No scanner consumes the index yet — orphan/duplicate refinements are Tasks
  1.2/1.3 with their own PRs. The precision fixture inventory (19 findings)
  must remain byte-identical after this change.
- No fingerprint or `COMPARISON_VERSION` change (no detection semantics change).
- No reference *rewriting*, no vault mutation of any kind.
- CSS snippets, Dataview dynamic queries, publishing pipelines, and external
  applications remain **named boundaries**, not inferred references: the index
  documents that any vault path may be referenced through channels it cannot
  see. Consumers must treat "no inbound references" as *candidate* evidence,
  never proof.

## Design

### Data model

```ts
export type ReferenceSourceKind = "note-link" | "embed" | "frontmatter" | "canvas";

export type ReferenceCoverageFailure = {
	path: string;                                   // the .canvas file that failed
	reason: "malformed-json" | "read-failed" | "unexpected-shape";
	detail?: string;                                // error message when available
};

export type InboundReference = {
	count: number;        // total resolving references
	kinds: ReferenceSourceKind[];  // sorted unique
	sources: string[];    // sorted unique source file paths
};

export type ReferenceIndex = {
	inboundByPath: Map<string, InboundReference>;
	canvasFiles: string[];
	coverageFailures: ReferenceCoverageFailure[];
	coverageComplete: boolean;   // coverageFailures.length === 0
};
```

Rationale for a single `note-link` kind instead of splitting Wiki vs Markdown
links: Obsidian's `LinkCache` does not distinguish the two reliably across
versions, the scanner semantics that matter (orphan, keep decisions, impact
previews) do not depend on the distinction, and one kind keeps the model
derivable from both the plugin and the CLI adapter without new metadata.

### Builder

`buildReferenceIndex(ctx: ScanContext): Promise<ReferenceIndex>`:

1. **Markdown sources** — for every file in `ctx.markdownFiles`, read
   `metadataCache.getFileCache(file)` and resolve `links`, `embeds`, and
   `frontmatterLinks` via `metadataCache.getFirstLinkpathDest(link, source)`
   when available (plugin and CLI both provide it), falling back to
   `resolveVaultLinkTargets` otherwise (unit-test contexts). External URLs
   (`hasUriScheme`) are skipped. This mirrors exactly what the orphan scanner
   does today, so Markdown-level semantics cannot regress.
   References are collected from ALL markdown files, including files inside
   globally ignored folders — this matches the orphan scanner's current
   behavior (its candidate loop filters ignored folders, its reference
   collection does not) and keeps the index scanner-agnostic. Scanner-specific
   folder exclusions stay a per-scanner concern.
2. **Canvas sources** — for every file in `ctx.allFiles` with extension
   `canvas`, `vault.cachedRead` the file, `JSON.parse`, and resolve each
   `nodes[]` entry with `type === "file"` and a string `file` field through the
   same resolver (Canvas nodes store vault paths; basename and case-insensitive
   resolution come along for free from the shared resolver). Read errors,
   JSON parse errors, and non-object/`nodes`-missing shapes become structured
   coverage failures; one malformed Canvas file never aborts the scan.
3. **Determinism** — kinds and sources are sorted; counts are integers; the
   same inputs always produce a deep-equal index (required for fingerprint
   stability and the precision suite).

### Query API

```ts
makeEmptyReferenceIndex(): ReferenceIndex   // for tests and pre-scan contexts
getInboundReference(index, path): InboundReference | undefined
isReferenced(index, path): boolean
```

`coverageComplete` is the gate future consumers must check before treating
absence of references as actionable: Task 1.2 will forbid orphan-delete
eligibility while it is false, and Task 2.1 will block trash actions on it.

### Integration

- `ScanContext` gains a required `referenceIndex: ReferenceIndex` field. It is
  a type-only import cycle (`reference-index.ts` imports only the
  `ScanContext` type), which is safe under `isolatedModules`.
- `ScanRunner.run` builds the index once after assembling the base context and
  before the scanner loop; per-scanner contexts inherit it via the existing
  spread.
- `src/tests/helpers/scan-context.ts` seeds `makeEmptyReferenceIndex()` so
  existing unit tests keep compiling; individual tests may inject a built or
  hand-made index via `overrides`.
- **Deviation from the roadmap file list:** `cli/local-vault.ts` needs NO
  change — after PR #125 the adapter already provides alias-stripped
  `LinkCache`-shaped metadata, `getFirstLinkpathDest`, and a generic
  `cachedRead` that works for `.canvas` files. The roadmap listed the file
  speculatively; this design keeps it untouched.

### Cost model

Per scan the index adds: one `getFileCache` pass over markdown files (already
what the orphan scanner pays today — it stops paying it in Task 1.2), plus
reading every `.canvas` file (previously never read). The synthetic benchmark
vault contains no Canvas files, so the recorded Milestone 0 baseline
(`552 files | 246 issues | 59ms median`) remains directly comparable; Canvas
read cost is bounded by Canvas file count and covered by dedicated
reference-index tests (including a malformed-file batch test).

## Verification strategy

- `src/tests/reference-index.test.ts`: pure builder tests over hand-made
  contexts (kinds, counts, sources, external skip, unresolved skip, ignored
  folder inclusion) plus fixture-vault-based assertions via
  `scanFixtureVault`-style contexts: `attachments/canvas-image.png` carries a
  `canvas`-kind inbound entry from `canvas/board.canvas`;
  `frontmatter-doc.pdf` carries `frontmatter`; `photo.jpg` carries `embed`
  (and `note-link` from valid-links.md); a malformed `.canvas` yields a
  coverage failure and `coverageComplete === false`.
- `src/tests/scan-runner.test.ts`: the index is built once and reaches scanner
  contexts.
- `src/tests/scanner-precision.test.ts`: unchanged and green — the 19-line
  inventory proves no detection behavior moved.
- `npm run benchmark:scan` before/after: median scan duration within 15% of
  baseline.

## Risks

- **Obsidian `frontmatterLinks` availability**: present in `CachedMetadata`
  since Obsidian 1.5 (plugin minimum is 1.7.2) — safe. The CLI adapter already
  produces it.
- **Plugin Canvas `cachedRead` on non-markdown files**: supported by the
  Obsidian API for any `TFile`.
- **Index size**: bounded by total distinct resolving targets and source
  paths; sources arrays can grow with vault size but are strings already held
  by the metadata cache. If M2 previews need capping, that decision belongs to
  M2.
