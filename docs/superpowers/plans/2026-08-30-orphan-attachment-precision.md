# Orphan Attachment Precision Implementation Plan (Milestone 1, Task 1.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The orphan-attachment scanner consumes `ctx.referenceIndex` instead of rebuilding Markdown-only reference state, so Canvas-referenced attachments stop being false positives; findings gain size/recency/reference/coverage evidence; incomplete Canvas parsing yields ONE `unverified` coverage finding and suppresses delete fix actions.

**Architecture:** The scanner's candidate loop stays; `isReferenced(index, path)` replaces `collectReferencedPaths`. A single `buildCoverageFinding` summarizes `index.coverageFailures` when non-empty. `fixAction` is gated on `index.coverageComplete`. Link-resolution semantics already live in `buildReferenceIndex` (Task 1.1, merged) — this PR deletes the scanner's private copy rather than retesting it.

**Tech Stack:** TypeScript, Vitest, hand-built `ReferenceIndex` test fixtures

Design doc: `docs/superpowers/specs/2026-08-30-orphan-attachment-precision-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.2)

---

## Ground rules

- Branch: `fix/orphan-attachments-precision`, cut from latest `main` (must include the merged reference-index PR).
- One commit: `fix: reduce orphan attachment false positives`.
- The precision inventory flip 19 → 18 lines is INTENTIONAL: the `attachments/canvas-image.png` orphan finding disappears. Nothing else in the inventory may change.
- Orphan finding fingerprints stay `generateFingerprint("orphan-attachments", path, { orphan: true })` — do not fold the new evidence fields into the fingerprint (ignored findings must stay ignored).
- Deviation from the roadmap file list, documented in the design doc:
  - `src/report/render-issues.ts` needs NO change — `renderFindingEvidence` iterates evidence keys generically and the orphan summary reads only `evidence.lastModified`.
  - `src/report/markdown-export.ts` gets ONE minimal addition (a `Size` detail row) because `getMarkdownDetails` is per-scanner and would silently drop `size`.
  - Evidence records `referenceCount: 0` instead of a "reference sources" field — an orphan has no inbound sources by definition; source lists remain in the index for M1.3/M2.1.
- Do not modify `src/scanner/reference-index.ts`, `ScanRunner.ts`, or `cli/` — the index is consumed as-is.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b fix/orphan-attachments-precision
```

---

### Task 2: Rewrite the unit tests first (TDD)

**Files:**
- Modify: `src/tests/orphan-attachments.test.ts` (full rewrite)

The existing suite tests link resolution (same-name resolution, source-folder
preference, alias handling, the 2000-embed perf test) — behavior that now
lives in `buildReferenceIndex` and is already covered by
`src/tests/reference-index.test.ts`. The scanner's job reduces to: index
lookup, evidence, severity, gating, and the coverage finding. Replace the
entire file with:

```typescript
import { describe, it, expect } from "vitest";
import { orphanAttachmentsScanner } from "../scanner/scanners/orphan-attachments";
import type { ScanContext } from "../scanner/ScanContext";
import type {
	ReferenceCoverageFailure,
	ReferenceIndex,
	ReferenceSourceKind,
} from "../scanner/reference-index";
import { makeEmptyReferenceIndex } from "../scanner/reference-index";

function makeFile(path: string, mtime = 1000, size = 1024) {
	return { path, stat: { size, mtime } } as any;
}

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["orphan-attachments"]),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		watchedTags: [],
		ignoredFolders: [],
		referenceIndex: makeEmptyReferenceIndex(),
		...overrides,
	} as ScanContext;
}

function makeIndex(
	referenced: Record<string, { count?: number; kinds?: ReferenceSourceKind[]; sources?: string[] }>,
	coverageFailures: ReferenceCoverageFailure[] = [],
): ReferenceIndex {
	const inboundByPath = new Map(
		Object.entries(referenced).map(([path, entry]) => [
			path,
			{
				count: entry.count ?? 1,
				kinds: entry.kinds ?? ["note-link"],
				sources: entry.sources ?? ["notes/a.md"],
			},
		]),
	);
	return {
		inboundByPath,
		canvasFiles: [],
		coverageFailures,
		coverageComplete: coverageFailures.length === 0,
	};
}

const OLD_MTIME = Date.now() - 30 * 24 * 60 * 60 * 1000;

describe("orphanAttachmentsScanner", () => {
	it("detects attachments with no inbound references as candidates with rich evidence", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME, 4096);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["assets/orphan.png"]),
			referenceIndex: makeIndex({}),
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			primaryPath: "assets/orphan.png",
			severity: "warning",
			classification: "candidate",
			evidence: {
				size: 4096,
				lastModified: OLD_MTIME,
				referenceCount: 0,
				coverageComplete: true,
			},
			explanation: {
				why: "No note, embed, frontmatter link, or Canvas file node in the vault references this attachment.",
				caveat: "CSS, Dataview, publishing pipelines, and external tools can reference files outside this scan boundary.",
				nextStep: "Review external and generated references before moving the file to trash.",
			},
			fixAction: {
				kind: "trash-file",
				targetPaths: ["assets/orphan.png"],
			},
		});
	});

	it.each([
		["note-link", ["notes/a.md"]],
		["embed", ["notes/a.md"]],
		["frontmatter", ["notes/a.md"]],
		["canvas", ["canvas/board.canvas"]],
	] as const)("does not report attachments referenced via %s through the index", async (kind, sources) => {
		const img = makeFile("assets/used.png", OLD_MTIME);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["assets/used.png"]),
			referenceIndex: makeIndex({
				"assets/used.png": { count: 1, kinds: [kind as ReferenceSourceKind], sources: [...sources] },
			}),
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("downgrades recently modified orphans to info", async () => {
		const img = makeFile("assets/recent.png", Date.now() - 1000);
		const ctx = makeCtx({ allFiles: [img], filePathIndex: new Set(["assets/recent.png"]) });
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("info");
	});

	it("uses warning severity for old orphans", async () => {
		const img = makeFile("assets/old.png", OLD_MTIME);
		const ctx = makeCtx({ allFiles: [img], filePathIndex: new Set(["assets/old.png"]) });
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("warning");
	});

	it("skips non-attachment files", async () => {
		const md = makeFile("notes/a.md", OLD_MTIME, 100);
		const ctx = makeCtx({ allFiles: [md], filePathIndex: new Set(["notes/a.md"]) });
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files in ignored folders", async () => {
		const img = makeFile("templates/bg.png", OLD_MTIME);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["templates/bg.png"]),
			ignoredFolders: ["templates"],
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("omits the delete fix action while reference coverage is incomplete", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["assets/orphan.png"]),
			referenceIndex: makeIndex({}, [{ path: "canvas/bad.canvas", reason: "malformed-json" }]),
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		const orphan = issues.find((issue) => issue.title === "Orphan attachment");
		expect(orphan).toBeDefined();
		expect(orphan?.fixAction).toBeUndefined();
		expect(orphan?.evidence.coverageComplete).toBe(false);
		expect(orphan?.classification).toBe("candidate");
		expect(orphan?.explanation.nextStep).toBe(
			"Resolve the incomplete reference coverage below before moving the file to trash.",
		);
	});

	it("emits exactly one unverified coverage finding summarizing all failures", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME);
		const failures: ReferenceCoverageFailure[] = [
			{ path: "canvas/z-bad.canvas", reason: "unexpected-shape" },
			{ path: "canvas/a-bad.canvas", reason: "malformed-json", detail: "boom" },
		];
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["assets/orphan.png"]),
			referenceIndex: makeIndex({}, failures),
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		const coverage = issues.filter((issue) => issue.title === "Reference coverage incomplete");
		expect(coverage).toHaveLength(1);
		expect(coverage[0]).toMatchObject({
			scannerId: "orphan-attachments",
			severity: "info",
			classification: "unverified",
			primaryPath: "canvas/a-bad.canvas",
			relatedPaths: ["canvas/a-bad.canvas", "canvas/z-bad.canvas"],
			evidence: {
				failedCount: 2,
				failedPaths: "canvas/a-bad.canvas,canvas/z-bad.canvas",
				reasons: "malformed-json,unexpected-shape",
			},
		});
		expect(coverage[0].fixAction).toBeUndefined();
		expect(coverage[0].explanation.why).toContain("Canvas reference sources");
	});

	it("fingerprints the coverage finding deterministically per failure set", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME);
		const run = (failures: ReferenceCoverageFailure[]) =>
			makeCtx({
				allFiles: [img],
				filePathIndex: new Set(["assets/orphan.png"]),
				referenceIndex: makeIndex({}, failures),
			});
		const first = await orphanAttachmentsScanner.scan(
			run([{ path: "canvas/bad.canvas", reason: "malformed-json" }]),
		);
		const second = await orphanAttachmentsScanner.scan(
			run([{ path: "canvas/bad.canvas", reason: "malformed-json" }]),
		);
		const other = await orphanAttachmentsScanner.scan(
			run([{ path: "canvas/other.canvas", reason: "read-failed" }]),
		);
		const fingerprintOf = (ctxIssues: Awaited<ReturnType<typeof orphanAttachmentsScanner.scan>>) =>
			ctxIssues.find((issue) => issue.title === "Reference coverage incomplete")?.fingerprint;
		expect(fingerprintOf(second)).toBe(fingerprintOf(first));
		expect(fingerprintOf(other)).not.toBe(fingerprintOf(first));
	});

	it("emits no coverage finding when coverage is complete", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME);
		const ctx = makeCtx({ allFiles: [img], filePathIndex: new Set(["assets/orphan.png"]) });
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues.some((issue) => issue.title === "Reference coverage incomplete")).toBe(false);
	});
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/orphan-attachments.test.ts
```

Expected: FAIL — the current scanner ignores `referenceIndex`, so the `it.each`
reference cases report orphans, evidence assertions miss `size`/
`referenceCount`/`coverageComplete`, and no "Reference coverage incomplete"
title exists.

---

### Task 3: Implement the scanner

**Files:**
- Modify: `src/scanner/scanners/orphan-attachments.ts` (full rewrite)

Replace the entire file with:

```typescript
import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isAttachment } from "../../utils/file-types";
import { isIgnoredPath } from "../../utils/paths";
import {
	isReferenced,
	type ReferenceCoverageFailure,
} from "../reference-index";

export const orphanAttachmentsScanner = {
	id: "orphan-attachments" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const index = ctx.referenceIndex;

		for (const file of ctx.allFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;
			if (!isAttachment(file.path)) continue;
			if (isReferenced(index, file.path)) continue;

			const severity = isRecent(file.stat.mtime) ? "info" : "warning";
			issues.push({
				scannerId: "orphan-attachments",
				severity,
				title: "Orphan attachment",
				message: "This attachment is not referenced by any note",
				primaryPath: file.path,
				relatedPaths: [],
				evidence: {
					size: file.stat.size,
					lastModified: file.stat.mtime,
					// Referenced files are skipped above, so this is always 0;
					// recorded to make "no inbound references" explicit evidence.
					referenceCount: 0,
					coverageComplete: index.coverageComplete,
				},
				...describeFinding(
					"candidate",
					"No note, embed, frontmatter link, or Canvas file node in the vault references this attachment.",
					index.coverageComplete
						? "Review external and generated references before moving the file to trash."
						: "Resolve the incomplete reference coverage below before moving the file to trash.",
					"CSS, Dataview, publishing pipelines, and external tools can reference files outside this scan boundary.",
				),
				fingerprint: generateFingerprint("orphan-attachments", file.path, {
					orphan: true,
				}),
				// Delete eligibility requires complete reference coverage:
				// unresolved Canvas content could reference this file.
				...(index.coverageComplete
					? {
							fixAction: {
								kind: "trash-file" as const,
								label: "Delete",
								description: `Move "${file.path}" to trash`,
								targetPaths: [file.path],
							},
						}
					: {}),
			});
		}

		if (index.coverageFailures.length > 0) {
			issues.push(buildCoverageFinding(index.coverageFailures));
		}

		return issues;
	},
};

function buildCoverageFinding(failures: ReferenceCoverageFailure[]): Issue {
	const sorted = [...failures].sort((a, b) =>
		a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
	);
	const failedPaths = sorted.map((failure) => failure.path);
	const reasons = [...new Set(sorted.map((failure) => failure.reason))].sort().join(",");
	return {
		scannerId: "orphan-attachments",
		severity: "info",
		title: "Reference coverage incomplete",
		message: `${failedPaths.length} Canvas file${failedPaths.length === 1 ? "" : "s"} could not be parsed (${reasons}); orphan results may be incomplete`,
		primaryPath: failedPaths[0],
		relatedPaths: failedPaths,
		evidence: {
			failedCount: failedPaths.length,
			failedPaths: failedPaths.join(","),
			reasons,
		},
		...describeFinding(
			"unverified",
			"Canvas reference sources could not be fully parsed, so the absence of references for some attachments is not yet trustworthy.",
			"Fix or remove the malformed Canvas file(s) listed here, then rescan.",
		),
		fingerprint: generateFingerprint("orphan-attachments", failedPaths[0], {
			coverageFailure: true,
			paths: failedPaths.join(","),
		}),
	};
}

function isRecent(mtime: number): boolean {
	const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
	return mtime > oneWeekAgo;
}
```

- [ ] **Step 2: Run the unit tests**

```bash
npm test -- src/tests/orphan-attachments.test.ts
```

Expected: PASS (12 tests). The precision suite still FAILS at this point — the
Canvas flip has not been pinned yet (next task).

---

### Task 4: Update the precision suite (pin the intentional flip)

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

- [ ] **Step 1: Update `EXPECTED_INVENTORY` (19 → 18 lines)**

Delete exactly one line from the `EXPECTED_INVENTORY` array — the
`canvas-image.png` orphan (sorted position between `recent-orphan.png` and
`orphan.png`). The array becomes:

```typescript
const EXPECTED_INVENTORY: string[] = [
	"broken-links | error | confirmed | Missing Note,notes/hub/broken-links.md | Linked file not found: Missing Note",
	"broken-links | error | confirmed | missing-embed.png,notes/hub/broken-links.md | Attachment not found: missing-embed.png",
	"broken-links | error | confirmed | missing-photo.png,notes/hub/broken-links.md | Attachment not found: missing-photo.png",
	"broken-links | error | confirmed | missing-target.md,notes/hub/broken-links.md | Linked file not found: missing-target.md",
	"broken-links | warning | confirmed | notes/hub/broken-links.md,notes/target.md | Heading \"#Missing Heading\" not found in notes/target.md",
	"duplicate-files | info | candidate | ,duplicates/archive/notes-a.txt,duplicates/notes-a.txt | 2 files share the name \"notes-a.txt\"",
	"duplicate-files | info | candidate | ,duplicates/size-twin-one.bin,duplicates/size-twin-two.bin | 2 files share size 48 B",
	"duplicate-files | warning | confirmed | ,duplicates/backup/fixture-data.bin,duplicates/original/fixture-data.bin | 2 files have identical content",
	"empty-notes | warning | candidate | notes/empty/cjk-stub.md | This note only has 2 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/embed-only.md | This note only has 1 word (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/frontmatter-only.md | This note has no content besides a title",
	"empty-notes | warning | candidate | notes/empty/genuine-empty.md | This note has no content besides a title",
	"empty-notes | warning | candidate | notes/empty/short-link-moc.md | This note only has 2 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/stub.md | This note only has 3 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/task-note.md | This note only has 5 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/title-only.md | This note has no content besides a title",
	"orphan-attachments | info | candidate | attachments/recent-orphan.png | This attachment is not referenced by any note",
	"orphan-attachments | warning | candidate | attachments/orphan.png | This attachment is not referenced by any note",
];
```

- [ ] **Step 2: Replace the `orphan attachments` describe block**

Replace the whole block (from `describe("orphan attachments", () => {`
through its closing `});`) with:

```typescript
		describe("orphan attachments", () => {
			const scanOrphans = () =>
				scanWithRecentOrphan().then(({ issues }) =>
					issues.filter((issue) => issue.scannerId === "orphan-attachments"),
				);

			it("reports exactly the two unreferenced attachments as candidates", async () => {
				const orphans = await scanOrphans();
				expect(orphans).toHaveLength(2);
				expect(orphans.every((issue) => issue.classification === "candidate")).toBe(true);
				expect(orphans.every((issue) => issue.fixAction?.kind === "trash-file")).toBe(true);
				expect(orphans.every((issue) => issue.evidence.coverageComplete === true)).toBe(true);
				expect(orphans.map((issue) => issue.primaryPath).sort()).toEqual([
					"attachments/orphan.png",
					"attachments/recent-orphan.png",
				]);
			});

			it("treats the Canvas-referenced attachment as referenced — former false positive boundary", async () => {
				const orphans = await scanOrphans();
				expect(
					orphans.some((issue) => issue.primaryPath === "attachments/canvas-image.png"),
				).toBe(false);
			});

			it("downgrades the recently modified orphan to info severity", async () => {
				const orphans = await scanOrphans();
				const recent = orphans.find(
					(issue) => issue.primaryPath === "attachments/recent-orphan.png",
				);
				expect(recent?.severity).toBe("info");
			});

			it("does not report Markdown, frontmatter, or Unicode referenced attachments", async () => {
				const orphans = await scanOrphans();
				const referenced = [
					"attachments/photo.jpg",
					"attachments/frontmatter-doc.pdf",
					"attachments/目标图片.png",
				];
				expect(
					orphans.some((issue) => referenced.includes(issue.primaryPath ?? "")),
				).toBe(false);
			});
		});
```

- [ ] **Step 3: Run the focused suites (roadmap verification)**

```bash
npm test -- src/tests/orphan-attachments.test.ts src/tests/scanner-precision.test.ts
```

Expected: PASS. Known Markdown, frontmatter, and Canvas references produce no
orphan findings; the fixture vault's canvas parses cleanly so no coverage
finding appears and no deletion is authorized on incomplete coverage.

---

### Task 5: Markdown export detail row

**Files:**
- Modify: `src/report/markdown-export.ts`

`render-issues.ts` needs no change (see Ground rules — the evidence
disclosure is generic). Only `getMarkdownDetails` drops the new `size`
evidence for orphans.

- [ ] **Step 1: Add the Size row to the orphan branch**

In `getMarkdownDetails`, replace:

```typescript
	if (issue.scannerId === "orphan-attachments") {
		const lastModified = getNumber(issue.evidence.lastModified);
		if (lastModified !== null) {
			details.push({ label: "Modified", value: new Date(lastModified).toLocaleString() });
		}
	}
```

with:

```typescript
	if (issue.scannerId === "orphan-attachments") {
		const lastModified = getNumber(issue.evidence.lastModified);
		if (lastModified !== null) {
			details.push({ label: "Modified", value: new Date(lastModified).toLocaleString() });
		}
		const size = getNumber(issue.evidence.size);
		if (size !== null) details.push({ label: "Size", value: formatSize(size) });
	}
```

(`formatSize` is already imported in that file; `getNumber` already exists
there.)

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0. The full run includes `src/tests/cli.test.ts`,
`src/tests/report-filters.test.ts`, and snapshot/diff tests — none of them
pin orphan behavior that changes here (verified: they reference the scanner
id only for filtering/grouping fixtures).

---

### Task 6: Commit and PR

- [ ] **Step 1: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/scanner/scanners/orphan-attachments.ts`,
`src/tests/orphan-attachments.test.ts`,
`src/tests/scanner-precision.test.ts`,
`src/report/markdown-export.ts`. NOT `src/scanner/reference-index.ts`,
`ScanRunner.ts`, `ScanContext.ts`, `src/report/render-issues.ts`, `cli/`, or
`src/main.ts`.

- [ ] **Step 2: Commit and push**

```bash
git add src/scanner/scanners/orphan-attachments.ts src/tests/orphan-attachments.test.ts src/tests/scanner-precision.test.ts src/report/markdown-export.ts
git commit -m "fix: reduce orphan attachment false positives"
git push -u origin fix/orphan-attachments-precision
```

- [ ] **Step 3: Open the PR** against `main`, titled
  `fix: reduce orphan attachment false positives`, covering: behavior change
  (Canvas-referenced attachments no longer orphans; inventory 19 → 18 with the
  exact flipped line named); evidence enrichment (size, referenceCount,
  coverageComplete; lastModified unchanged); the new `unverified` coverage
  finding and delete-gating under incomplete Canvas coverage; render/export
  finding (render-issues unchanged — generic evidence rendering;
  markdown-export gained a Size row); fingerprint compatibility (orphan
  fingerprints unchanged so ignore-lists survive); focused tests run plus
  full gates; remaining boundaries (CSS, Dataview, publishing, external
  tools — still named, still `candidate`).

## Self-review checklist (completed during plan writing)

- Roadmap Task 1.2 requirements ↔ tasks: consume `ctx.referenceIndex` / delete `collectReferencedPaths` ✓ (Task 3, import list contains no `resolveVaultLinkTargets`); Canvas-referenced = referenced ✓ (Task 2 `it.each` canvas case + Task 4 flipped boundary test); evidence size + mtime + reference sources + coverage completeness ✓ (Task 3 evidence block; "sources" deviation documented — `referenceCount: 0`, design doc explains); stays `candidate` ✓; `unverified` coverage finding on incomplete Canvas parsing ✓ (one finding, deterministic fingerprint, Task 2 tests); no orphan-delete eligibility while coverage incomplete ✓ (fixAction gating + tests); recent-file `info` severity preserved ✓.
- Roadmap verification command reproduced in Task 4 Step 3 with expected outcome matching the roadmap's wording.
- No placeholders: every file edit ships complete code; the two full rewrites (`orphan-attachments.ts`, `orphan-attachments.test.ts`) and the two precise replacements (inventory array, orphan describe block, markdown-export branch) match the real current file contents.
- Type/name consistency verified against the codebase: `isReferenced` / `ReferenceCoverageFailure` exported from `src/scanner/reference-index.ts`; `describeFinding(classification, why, nextStep, caveat?)` order matches `src/scanner/finding-presentation.ts`; `Issue.evidence` is `Record<string, string | number | boolean>` (coverage finding uses scalar fields only); `generateFingerprint(scannerId, primaryPath, evidence)` matches `src/scanner/issue-fingerprint.ts`; `formatSize`/`getNumber` already imported/defined in `markdown-export.ts`; `makeScanContext` in `src/tests/helpers/scan-context.ts` seeds `makeEmptyReferenceIndex()` (the rewritten unit tests deliberately use a local `makeCtx` with the same default, mirroring the file they replace).
- Fingerprints: orphan findings keep `{ orphan: true }` evidence (ignore-list compatibility); coverage fingerprint varies with the failure path set and is order-independent (sorted before hashing).
