# Duplicate File Precision Implementation Plan (Milestone 1, Task 1.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The duplicate-files scanner gains per-file hash-state evidence (`hash-confirmed` / `cap-exceeded` / `read-failed`), inbound reference counts, and mtimes; automatic keep mode keeps the most-referenced path (ties by path order); hash-confirmed groups with 2+ referenced paths require an explicit keep choice before anything is trashed, in both keep modes; references are never rewritten.

**Architecture:** The three-phase pipeline (name → size → size-capped SHA-256) is preserved; phase 3 additionally records a per-file `HashState`. Keep selection and review gating derive from the shared reference index (`getInboundReference`). `KeepOneSelection` gains two optional additive fields (`referencedPaths`, `requiresReview`); `buildFixDecisionState` treats review groups like `always-ask`; `ConfirmFixModal` renders the keep radios and an impact line for review groups via a new pure `shouldAskForKeep` helper.

**Tech Stack:** TypeScript, Vitest, hand-built `ReferenceIndex` test fixtures

Design doc: `docs/superpowers/specs/2026-08-30-duplicate-file-precision-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.3)

---

## Ground rules

- Branch: `fix/duplicate-file-precision`, cut from latest `main` (must include the merged reference-index and orphan-attachment PRs).
  - Deviation from the roadmap PR list (item 3, `fix/orphan-and-duplicate-precision`): Task 1.2 already landed as its own PR (`fix/orphan-attachments-precision`), so this task ships separately under its own branch. Documented in the design doc's parent-roadmap dependency line.
- One commit: `fix: improve duplicate file decisions`.
- Fingerprints MUST stay byte-identical: `{ paths: sorted.join(",") }`, `{ nameCandidates: sorted }`, `{ sizeCandidates: sorted }`. New evidence never enters fingerprints. `COMPARISON_VERSION` stays `1`.
- The precision suite (`src/tests/scanner-precision.test.ts`) is NOT modified: the fixture's duplicate pair is unreferenced (keep stays `duplicates/backup/fixture-data.bin` via the tie-break), the inventory contains no evidence fields, and the 18-line inventory is unchanged.
- Deviation from the roadmap file list, documented in the design doc:
  - `src/scanner/Issue.ts` also changes — `KeepOneSelection` lives there and gains the two optional fields. The roadmap file list omitted it.
  - The new selection fields are OPTIONAL so `src/tests/main.test.ts` selection literals keep compiling and keep today's behavior; that file is not touched.
- References are never rewritten: no new fix-action kinds; `resolveDecisionAction` only filters `targetPaths`.
- Do not modify `src/scanner/reference-index.ts`, `ScanRunner.ts`, `ScanContext.ts`, `src/report/*`, `src/snapshot/*`, `cli/`, or `src/main.ts`.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b fix/duplicate-file-precision
```

---

### Task 2: Rewrite the duplicate-files unit tests first (TDD)

**Files:**
- Modify: `src/tests/duplicate-files.test.ts` (full rewrite)

The rewritten suite seeds `referenceIndex` (the current `makeCtx` omits it —
the scanner would crash on `getInboundReference` otherwise) and pins the new
evidence, keep algorithm, and review gating. Replace the entire file with:

```typescript
import { describe, it, expect } from "vitest";
import { duplicateFilesScanner } from "../scanner/scanners/duplicate-files";
import type { ScanContext } from "../scanner/ScanContext";
import type { ReferenceIndex } from "../scanner/reference-index";
import { makeEmptyReferenceIndex } from "../scanner/reference-index";

function makeFile(path: string, size: number, mtime = 1000) {
	return {
		path,
		stat: { size, mtime },
	} as any;
}

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {
			readBinary: async (file: any) => {
				const encoder = new TextEncoder();
				return encoder.encode(file.path).buffer;
			},
		} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["duplicate-files"]),
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

function makeIndex(referenceCounts: Record<string, number>): ReferenceIndex {
	return {
		inboundByPath: new Map(
			Object.entries(referenceCounts).map(([path, count]) => [
				path,
				{ count, kinds: ["note-link"], sources: ["notes/a.md"] },
			]),
		),
		canvasFiles: [],
		coverageFailures: [],
		coverageComplete: true,
	};
}

describe("duplicateFilesScanner", () => {
	it("reports hash-identical files as warning with hash-state, reference, and mtime evidence", async () => {
		const sharedContent = new Uint8Array([1, 2, 3, 4]);
		const fileA = makeFile("notes/a.md", 4, 2000);
		const fileB = makeFile("notes/b.md", 4, 3000);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		const hashIssues = issues.filter((i) => i.severity === "warning");
		expect(hashIssues).toHaveLength(1);
		expect(hashIssues[0]).toMatchObject({
			classification: "confirmed",
			evidence: {
				count: 2,
				hashState: "hash-confirmed",
				referenceCounts: "0,0",
				mtimes: "2000,3000",
				referencedPaths: "",
			},
			explanation: {
				why: "SHA-256 content hashes match across 2 files.",
				caveat:
					"The files are byte-identical, but their locations can still serve different workflows.",
				nextStep:
					"Choose the file to keep before moving the remaining copies to trash.",
			},
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: 'Keep "notes/a.md" and move 1 duplicate(s) to trash',
				targetPaths: ["notes/b.md"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["notes/a.md", "notes/b.md"],
					automaticKeepPath: "notes/a.md",
					referencedPaths: [],
					requiresReview: false,
				},
			},
		});
	});

	it("keeps the path with the highest inbound reference count in automatic mode", async () => {
		const sharedContent = new Uint8Array([1, 2, 3]);
		const ctx = makeCtx({
			allFiles: [
				makeFile("notes/a.md", 3),
				makeFile("notes/b.md", 3),
				makeFile("notes/c.md", 3),
			],
			filePathIndex: new Set(["notes/a.md", "notes/b.md", "notes/c.md"]),
			referenceIndex: makeIndex({
				"notes/a.md": 0,
				"notes/b.md": 3,
				"notes/c.md": 1,
			}),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const [issue] = await duplicateFilesScanner.scan(ctx);
		expect(issue.fixAction?.selection?.automaticKeepPath).toBe("notes/b.md");
		expect(issue.fixAction?.targetPaths).toEqual(["notes/a.md", "notes/c.md"]);
		expect(issue.evidence.referenceCounts).toBe("0,3,1");
		expect(issue.evidence.referencedPaths).toBe("notes/b.md,notes/c.md");
	});

	it("breaks equal reference counts by stable vault-relative path order", async () => {
		const sharedContent = new Uint8Array([1, 2, 3]);
		const ctx = makeCtx({
			allFiles: [
				makeFile("z-last/copy.md", 3),
				makeFile("a-first/copy.md", 3),
				makeFile("m-middle/copy.md", 3),
			],
			filePathIndex: new Set([
				"z-last/copy.md",
				"a-first/copy.md",
				"m-middle/copy.md",
			]),
			referenceIndex: makeIndex({
				"z-last/copy.md": 2,
				"a-first/copy.md": 2,
				"m-middle/copy.md": 0,
			}),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const [issue] = await duplicateFilesScanner.scan(ctx);
		expect(issue.fixAction?.selection).toMatchObject({
			candidatePaths: [
				"a-first/copy.md",
				"m-middle/copy.md",
				"z-last/copy.md",
			],
			automaticKeepPath: "a-first/copy.md",
			referencedPaths: ["a-first/copy.md", "z-last/copy.md"],
			requiresReview: true,
		});
		expect(issue.fixAction?.targetPaths).toEqual([
			"m-middle/copy.md",
			"z-last/copy.md",
		]);
		expect(issue.explanation.nextStep).toBe(
			"Several copies are referenced from notes. Review which location to keep before moving any copy to trash.",
		);
	});

	it("does not require review when only one copy is referenced", async () => {
		const sharedContent = new Uint8Array([1, 2, 3]);
		const ctx = makeCtx({
			allFiles: [makeFile("notes/a.md", 3), makeFile("notes/b.md", 3)],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			referenceIndex: makeIndex({ "notes/b.md": 1 }),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const [issue] = await duplicateFilesScanner.scan(ctx);
		expect(issue.fixAction?.selection).toMatchObject({
			automaticKeepPath: "notes/b.md",
			referencedPaths: ["notes/b.md"],
			requiresReview: false,
		});
	});

	it("reports same-name candidates with per-file hash states when content differs", async () => {
		const fileA = makeFile("notes/readme.md", 10, 5000);
		const fileB = makeFile("archive/readme.md", 20, 6000);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/readme.md", "archive/readme.md"]),
			referenceIndex: makeIndex({ "notes/readme.md": 2 }),
			vault: {
				readBinary: async (file: any) => {
					const encoder = new TextEncoder();
					return encoder.encode(`unique-${file.path}`).buffer;
				},
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		const nameIssues = issues.filter((i) => i.title.includes("same name"));
		expect(nameIssues).toHaveLength(1);
		expect(nameIssues[0].severity).toBe("info");
		expect(nameIssues[0].classification).toBe("candidate");
		expect(nameIssues[0].evidence).toMatchObject({
			hashStates: "hash-confirmed",
			referenceCounts: "2,0",
			mtimes: "5000,6000",
		});
		// Aligned by index with relatedPaths (sorted).
		expect(nameIssues[0].relatedPaths).toEqual([
			"archive/readme.md",
			"notes/readme.md",
		]);
		expect(nameIssues[0].fixAction).toBeUndefined();
	});

	it("degrades read failures to candidates with read-failed hash states", async () => {
		const fileA = makeFile("notes/a.md", 10);
		const fileB = makeFile("notes/b.md", 10);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => {
					throw new Error("simulated read failure");
				},
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues.some((i) => i.severity === "warning")).toBe(false);
		const candidates = issues.filter((i) => i.classification === "candidate");
		// Same size, different names: exactly one same-size candidate group.
		expect(candidates).toHaveLength(1);
		expect(
			candidates.every((i) => i.evidence.hashStates === "read-failed"),
		).toBe(true);
		expect(candidates.every((i) => i.fixAction === undefined)).toBe(true);
	});

	it("reports above-cap same-size files as cap-exceeded candidates", async () => {
		const fileA = makeFile("notes/big1.bin", 2 * 1024 * 1024);
		const fileB = makeFile("notes/big2.bin", 2 * 1024 * 1024);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/big1.bin", "notes/big2.bin"]),
			duplicateHashMaxBytes: 1024 * 1024,
			vault: {
				readBinary: async () => new ArrayBuffer(0),
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("info");
		expect(issues[0].evidence.hashStates).toBe("cap-exceeded");
	});

	it("does not report unique files", async () => {
		const fileA = makeFile("notes/a.md", 10);
		const fileB = makeFile("notes/b.md", 20);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async (file: any) => {
					const encoder = new TextEncoder();
					return encoder.encode(`unique-${file.path}`).buffer;
				},
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips empty files", async () => {
		const fileA = makeFile("notes/a.md", 0);
		const fileB = makeFile("notes/b.md", 0);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => new ArrayBuffer(0),
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files in ignored folders", async () => {
		const sharedContent = new Uint8Array([1, 2, 3]);
		const fileA = makeFile("templates/a.md", 3);
		const fileB = makeFile("templates/b.md", 3);
		const ctx = makeCtx({
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["templates/a.md", "templates/b.md"]),
			ignoredFolders: ["templates"],
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		});
		const issues = await duplicateFilesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("produces stable fingerprints", async () => {
		const sharedContent = new Uint8Array([5, 6, 7]);
		const fileA = makeFile("notes/a.md", 3);
		const fileB = makeFile("notes/b.md", 3);
		const base = {
			allFiles: [fileA, fileB],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		};
		const issues1 = await duplicateFilesScanner.scan(makeCtx(base));
		const issues2 = await duplicateFilesScanner.scan(makeCtx(base));
		expect(issues1[0].fingerprint).toBe(issues2[0].fingerprint);
	});

	it("keeps fingerprints stable when reference counts change", async () => {
		const sharedContent = new Uint8Array([5, 6, 7]);
		const base = {
			allFiles: [makeFile("notes/a.md", 3), makeFile("notes/b.md", 3)],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			vault: {
				readBinary: async () => sharedContent.buffer,
			} as any,
		};
		const unreferenced = await duplicateFilesScanner.scan(makeCtx(base));
		const referenced = await duplicateFilesScanner.scan(
			makeCtx({ ...base, referenceIndex: makeIndex({ "notes/b.md": 4 }) }),
		);
		expect(referenced[0].fingerprint).toBe(unreferenced[0].fingerprint);
	});
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/duplicate-files.test.ts
```

Expected: FAIL — the current scanner emits no `hashState`/`referenceCounts`/
`mtimes`/`referencedPaths` evidence, no `referencedPaths`/`requiresReview`
selection fields, picks `sorted[0]` as automatic keep regardless of reference
counts, and its candidate findings lack `hashStates`. (The current `makeCtx`
also omits `referenceIndex`, which the new scanner requires.)

---

### Task 3: Extend the selection type and rewrite the scanner

**Files:**
- Modify: `src/scanner/Issue.ts`
- Modify: `src/scanner/scanners/duplicate-files.ts` (full rewrite)

- [ ] **Step 1: Add the optional selection fields to `Issue.ts`**

Replace:

```typescript
export type KeepOneSelection = {
	kind: "keep-one";
	candidatePaths: string[];
	automaticKeepPath: string;
};
```

with:

```typescript
export type KeepOneSelection = {
	kind: "keep-one";
	candidatePaths: string[];
	automaticKeepPath: string;
	/** Paths in the group with inbound references (sorted). */
	referencedPaths?: string[];
	/** True when 2+ paths have inbound references: an explicit keep choice is required even in automatic mode. */
	requiresReview?: boolean;
};
```

- [ ] **Step 2: Replace the entire scanner file with:**

```typescript
import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { hashContent } from "../../utils/hash";
import { getBasename, getExtension, isIgnoredPath } from "../../utils/paths";
import { formatSize } from "../../utils/format";
import { getInboundReference, type ReferenceIndex } from "../reference-index";

/**
 * Why a candidate file's content identity is or is not known:
 * - "hash-confirmed": SHA-256 was computed. On the warning finding this means
 *   byte-identical to the group; on a candidate finding it means the hash was
 *   compared and no identical copy exists.
 * - "cap-exceeded": above duplicateHashMaxBytes; identity unknown.
 * - "read-failed": vault.readBinary threw; identity unknown.
 */
type HashState = "hash-confirmed" | "cap-exceeded" | "read-failed";

export const duplicateFilesScanner = {
	id: "duplicate-files" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];
		const files = ctx.allFiles.filter(
			(f) => f.stat.size > 0 && !isIgnoredPath(f.path, ctx.ignoredFolders),
		);
		const filesByPath = new Map(files.map((file) => [file.path, file]));
		const index = ctx.referenceIndex;
		const inboundCount = (path: string): number =>
			getInboundReference(index, path)?.count ?? 0;

		// Phase 1: group by basename + extension
		const nameGroups = new Map<string, typeof files>();
		for (const file of files) {
			const key = `${getBasename(file.path)}.${getExtension(file.path)}`;
			const group = nameGroups.get(key) ?? [];
			group.push(file);
			nameGroups.set(key, group);
		}

		// Phase 2: group by byte size
		const sizeGroups = new Map<number, typeof files>();
		for (const file of files) {
			const group = sizeGroups.get(file.stat.size) ?? [];
			group.push(file);
			sizeGroups.set(file.stat.size, group);
		}

		// Collect candidate files (appear in a group of 2+)
		const candidates = new Set<typeof files[number]>();
		for (const [, group] of nameGroups) {
			if (group.length >= 2) group.forEach((f) => candidates.add(f));
		}
		for (const [, group] of sizeGroups) {
			if (group.length >= 2) group.forEach((f) => candidates.add(f));
		}

		// Phase 3: hash candidates below cap, tracking per-file hash state
		const hashGroups = new Map<string, string[]>();
		const hashStates = new Map<string, HashState>();
		for (const file of candidates) {
			if (file.stat.size > ctx.duplicateHashMaxBytes) {
				hashStates.set(file.path, "cap-exceeded");
				continue;
			}
			try {
				const content = await ctx.vault.readBinary(file);
				const hash = await hashContent(content);
				hashStates.set(file.path, "hash-confirmed");
				const group = hashGroups.get(hash) ?? [];
				group.push(file.path);
				hashGroups.set(hash, group);
			} catch {
				hashStates.set(file.path, "read-failed");
			}
		}

		// Per-file evidence aligned BY INDEX with each finding's relatedPaths.
		const referenceCountsOf = (sorted: string[]) =>
			sorted.map(inboundCount).join(",");
		const mtimesOf = (sorted: string[]) =>
			sorted.map((path) => filesByPath.get(path)?.stat.mtime ?? 0).join(",");

		// Report hash-identical as warning
		const hashReportedPaths = new Set<string>();
		for (const [, paths] of hashGroups) {
			if (paths.length < 2) continue;
			paths.forEach((p) => hashReportedPaths.add(p));
			const sorted = paths.slice().sort();
			const referencedPaths = sorted.filter((path) => inboundCount(path) > 0);
			const requiresReview = referencedPaths.length >= 2;
			const kept = pickAutomaticKeepPath(sorted, index);
			const duplicates = sorted.filter((path) => path !== kept);
			issues.push({
				scannerId: "duplicate-files",
				severity: "warning",
				title: "Duplicate files (hash-identical)",
				message: `${paths.length} files have identical content`,
				primaryPath: undefined,
				relatedPaths: sorted,
				evidence: {
					count: paths.length,
					paths: paths.join(", "),
					hashState: "hash-confirmed",
					referenceCounts: referenceCountsOf(sorted),
					mtimes: mtimesOf(sorted),
					referencedPaths: referencedPaths.join(","),
				},
				...describeFinding(
					"confirmed",
					`SHA-256 content hashes match across ${paths.length} files.`,
					requiresReview
						? "Several copies are referenced from notes. Review which location to keep before moving any copy to trash."
						: "Choose the file to keep before moving the remaining copies to trash.",
					"The files are byte-identical, but their locations can still serve different workflows.",
				),
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					paths: sorted.join(","),
				}),
				fixAction: {
					kind: "trash-file",
					label: "Delete duplicates",
					description: `Keep "${kept}" and move ${duplicates.length} duplicate(s) to trash`,
					targetPaths: duplicates,
					selection: {
						kind: "keep-one",
						candidatePaths: sorted,
						automaticKeepPath: kept,
						referencedPaths,
						requiresReview,
					},
				},
			});
		}

		// Report name candidates not covered by hash as info
		for (const [name, group] of nameGroups) {
			if (group.length < 2) continue;
			const unreached = group
				.filter((f) => !hashReportedPaths.has(f.path))
				.map((f) => f.path)
				.sort();
			if (unreached.length < 2) continue;
			issues.push({
				scannerId: "duplicate-files",
				severity: "info",
				title: "Duplicate file candidates (same name)",
				message: `${unreached.length} files share the name "${name}"`,
				relatedPaths: unreached,
				evidence: {
					count: unreached.length,
					paths: unreached.join(", "),
					hashStates: statesOf(hashStates, unreached),
					referenceCounts: referenceCountsOf(unreached),
					mtimes: mtimesOf(unreached),
				},
				...describeFinding(
					"candidate",
					`${unreached.length} files share the same filename.`,
					"Compare their content and usage before deciding whether either file is redundant.",
					"Matching names do not prove matching content.",
				),
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					nameCandidates: unreached.join(","),
				}),
			});
		}

		// Report size candidates not covered by hash as info
		for (const [size, group] of sizeGroups) {
			if (group.length < 2) continue;
			const unreached = group
				.filter((f) => !hashReportedPaths.has(f.path))
				.map((f) => f.path)
				.sort();
			if (unreached.length < 2) continue;
			issues.push({
				scannerId: "duplicate-files",
				severity: "info",
				title: "Duplicate file candidates (same size)",
				message: `${unreached.length} files share size ${formatSize(size)}`,
				relatedPaths: unreached,
				evidence: {
					count: unreached.length,
					paths: unreached.join(", "),
					hashStates: statesOf(hashStates, unreached),
					referenceCounts: referenceCountsOf(unreached),
					mtimes: mtimesOf(unreached),
					size,
				},
				...describeFinding(
					"candidate",
					`${unreached.length} files share the same byte size.`,
					"Compare their content and usage before deciding whether either file is redundant.",
					"Matching sizes do not prove matching content.",
				),
				fingerprint: generateFingerprint("duplicate-files", undefined, {
					sizeCandidates: unreached.join(","),
				}),
			});
		}

		return issues;
	},
};

/**
 * Automatic keep policy: the path with the highest inbound reference count
 * wins; equal counts break to the lexicographically smallest vault-relative
 * path so the choice is deterministic.
 */
function pickAutomaticKeepPath(
	paths: string[],
	index: ReferenceIndex,
): string {
	let best = paths[0];
	let bestCount = getInboundReference(index, best)?.count ?? 0;
	for (const path of paths.slice(1)) {
		const count = getInboundReference(index, path)?.count ?? 0;
		if (count > bestCount || (count === bestCount && path < best)) {
			best = path;
			bestCount = count;
		}
	}
	return best;
}

function statesOf(
	hashStates: Map<string, HashState>,
	paths: string[],
): string {
	return [...new Set(paths.map((path) => hashStates.get(path) ?? "cap-exceeded"))]
		.sort()
		.join(",");
}
```

Design notes for reviewers:

- Candidate fingerprints keep their exact inputs — `unreached` is now built
  sorted, and the old code already sorted inside `generateFingerprint`, so the
  hashed evidence string is byte-identical.
- `primaryPath: undefined` is stated explicitly (the old code relied on the
  field being optional); no renderer or inventory reads it for duplicates.
- `statesOf` falls back to `"cap-exceeded"` defensively for a path that
  escaped state tracking; every candidate passes through phase 3, so the
  fallback is unreachable in practice.

- [ ] **Step 3: Run the scanner unit tests**

```bash
npm test -- src/tests/duplicate-files.test.ts
```

Expected: PASS (12 tests). `src/tests/fix-decisions.test.ts` and
`src/tests/confirm-modal.test.ts` still pass — the new selection fields are
optional — but the gating they must enforce does not exist yet (next task).

---

### Task 4: Enforce review gating in fix decisions

**Files:**
- Modify: `src/fix/fix-decisions.ts`
- Modify: `src/tests/fix-decisions.test.ts`

- [ ] **Step 1: Write the failing tests first**

In `src/tests/fix-decisions.test.ts`, extend the `makeDuplicateIssue` factory
by replacing:

```typescript
function makeDuplicateIssue(
	fingerprint = "duplicates",
	paths = ["a.md", "b.md", "c.md"],
): Issue {
	const sorted = paths.slice().sort();
	const automaticKeepPath = sorted[0];
	const action: FixAction = {
		kind: "trash-file",
		label: "Delete duplicates",
		description:
			`Keep "${automaticKeepPath}" and move ${sorted.length - 1} duplicate(s) to trash`,
		targetPaths: sorted.slice(1),
		selection: {
			kind: "keep-one",
			candidatePaths: sorted,
			automaticKeepPath,
		},
	};
```

with:

```typescript
function makeDuplicateIssue(
	fingerprint = "duplicates",
	paths = ["a.md", "b.md", "c.md"],
	referencedPaths: string[] = [],
): Issue {
	const sorted = paths.slice().sort();
	const automaticKeepPath = sorted[0];
	const action: FixAction = {
		kind: "trash-file",
		label: "Delete duplicates",
		description:
			`Keep "${automaticKeepPath}" and move ${sorted.length - 1} duplicate(s) to trash`,
		targetPaths: sorted.slice(1),
		selection: {
			kind: "keep-one",
			candidatePaths: sorted,
			automaticKeepPath,
			referencedPaths,
			requiresReview: referencedPaths.length >= 2,
		},
	};
```

Then append these tests inside `describe("fix decisions", () => {`, before
its closing `});`:

```typescript
	it("requires an explicit keep path in automatic mode when the group needs review", () => {
		const issue = makeDuplicateIssue("duplicates", ["a.md", "b.md", "c.md"], [
			"a.md",
			"b.md",
		]);

		const withoutChoice = buildFixDecisionState([issue], "automatic", new Map());
		expect(withoutChoice.complete).toBe(false);
		expect(withoutChoice.decisions).toEqual([]);

		const withChoice = buildFixDecisionState(
			[issue],
			"automatic",
			new Map([["duplicates", "c.md"]]),
		);
		expect(withChoice).toEqual({
			complete: true,
			decisions: [{ fingerprint: "duplicates", keepPath: "c.md" }],
		});
	});

	it("still honors the automatic keep path when only one copy is referenced", () => {
		const issue = makeDuplicateIssue("duplicates", ["a.md", "b.md", "c.md"], [
			"b.md",
		]);
		const state = buildFixDecisionState([issue], "automatic", new Map());
		expect(state).toEqual({
			complete: true,
			decisions: [{ fingerprint: "duplicates", keepPath: "a.md" }],
		});
	});

	it("rejects a fresh action whose review requirement changed", () => {
		const requested = makeDuplicateIssue();
		const fresh = makeDuplicateIssue(
			"duplicates",
			["a.md", "b.md", "c.md"],
			["a.md", "b.md"],
		);

		expect(getFreshFixAction(requested, fresh, {
			fingerprint: "duplicates",
			keepPath: "c.md",
		})).toBeNull();
	});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/fix-decisions.test.ts
```

Expected: FAIL — the first new test: `automatic` mode currently auto-takes
`automaticKeepPath`, so `complete` is `true` with a `keepPath: "a.md"`
decision. The third new test: `getFreshFixAction` currently ignores the
review flag.

- [ ] **Step 3: Implement the gate**

In `src/fix/fix-decisions.ts`, replace:

```typescript
		const keepPath = mode === "automatic"
			? selection.automaticKeepPath
			: selectedKeeps.get(issue.fingerprint);
```

with:

```typescript
		// Review-required groups (2+ referenced paths) demand an explicit
		// keep choice even in automatic mode: trashing a referenced copy
		// breaks live links, and references are never rewritten.
		const keepPath = mode === "automatic" && !selection.requiresReview
			? selection.automaticKeepPath
			: selectedKeeps.get(issue.fingerprint);
```

Then in `getFreshFixAction`, replace:

```typescript
		if (
			!requested.selection
			|| !fresh.selection
			|| requested.kind !== fresh.kind
			|| requested.label !== fresh.label
			|| !samePaths(
				requested.selection.candidatePaths,
				fresh.selection.candidatePaths,
			)
		) {
			return null;
		}
```

with:

```typescript
		if (
			!requested.selection
			|| !fresh.selection
			|| requested.kind !== fresh.kind
			|| requested.label !== fresh.label
			|| requested.selection.requiresReview !== fresh.selection.requiresReview
			|| !samePaths(
				requested.selection.candidatePaths,
				fresh.selection.candidatePaths,
			)
		) {
			return null;
		}
```

- [ ] **Step 4: Run the fix-decision tests**

```bash
npm test -- src/tests/fix-decisions.test.ts
```

Expected: PASS (11 tests) — the eight pre-existing tests are unaffected because
their fixtures default to `referencedPaths: []` (`requiresReview: false`).

---

### Task 5: Surface review groups in the confirmation modal

**Files:**
- Modify: `src/fix/confirm-modal.ts`
- Modify: `src/tests/confirm-modal.test.ts`

- [ ] **Step 1: Write the failing tests first**

In `src/tests/confirm-modal.test.ts`, update the imports by replacing:

```typescript
import {
	createSingleUseResolver,
	summarizeFixActions,
} from "../fix/confirm-modal";
```

with:

```typescript
import {
	createSingleUseResolver,
	shouldAskForKeep,
	summarizeFixActions,
} from "../fix/confirm-modal";
```

Then append these tests inside `describe("confirm modal action summary", () => {`,
before its closing `});`:

```typescript
	it("asks for a keep choice in always-ask mode or when review is required", () => {
		const plain = { kind: "keep-one" as const, candidatePaths: ["a.md"], automaticKeepPath: "a.md" };
		const review = {
			kind: "keep-one" as const,
			candidatePaths: ["a.md", "b.md"],
			automaticKeepPath: "a.md",
			referencedPaths: ["a.md", "b.md"],
			requiresReview: true,
		};

		expect(shouldAskForKeep("always-ask", plain)).toBe(true);
		expect(shouldAskForKeep("always-ask", review)).toBe(true);
		expect(shouldAskForKeep("automatic", plain)).toBe(false);
		expect(shouldAskForKeep("automatic", review)).toBe(true);
	});

	it("gates an automatic-mode review group on an explicit keep choice", () => {
		const issue: Issue = {
			scannerId: "duplicate-files",
			severity: "warning",
			classification: "confirmed",
			explanation: {
				why: "Test evidence confirms this fixture.",
				nextStep: "Review the test fixture.",
			},
			title: "Duplicate files (hash-identical)",
			message: "3 files have identical content",
			relatedPaths: ["a.md", "b.md", "c.md"],
			evidence: { count: 3, paths: "a.md, b.md, c.md" },
			fingerprint: "duplicates",
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: 'Keep "a.md" and move 2 duplicate(s) to trash',
				targetPaths: ["b.md", "c.md"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.md", "b.md", "c.md"],
					automaticKeepPath: "a.md",
					referencedPaths: ["a.md", "b.md"],
					requiresReview: true,
				},
			},
		};

		const incomplete = buildFixDecisionState([issue], "automatic", new Map());
		expect(incomplete.complete).toBe(false);

		const decided = buildFixDecisionState(
			[issue],
			"automatic",
			new Map([["duplicates", "c.md"]]),
		);
		expect(decided.complete).toBe(true);
		const action = decided.decisions
			.map((decision) => resolveDecisionAction(issue, decision))
			.find((action): action is FixAction => action !== null);
		expect(action?.targetPaths).toEqual(["a.md", "b.md"]);
	});
```

(The existing `import { buildFixDecisionState, resolveDecisionAction } from "../fix/fix-decisions";` and `import type { FixAction, Issue } from "../scanner/Issue";` already cover the new test's needs.)

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/confirm-modal.test.ts
```

Expected: FAIL — `shouldAskForKeep` is not exported. (The gating test itself
passes after Task 4; it lives here because it pins the modal-facing contract.)

- [ ] **Step 3: Implement the helper and modal changes**

In `src/fix/confirm-modal.ts`, replace:

```typescript
import type { FixAction, Issue } from "../scanner/Issue";
```

with:

```typescript
import type { FixAction, Issue, KeepOneSelection } from "../scanner/Issue";
```

Add after `showConfirmModal` (top-level export):

```typescript
/**
 * A keep-choice radio group is shown in always-ask mode, and for any group
 * flagged requiresReview (2+ referenced paths) regardless of mode — the
 * explicit choice is what unlocks the Confirm button.
 */
export function shouldAskForKeep(
	mode: DuplicateKeepMode,
	selection: KeepOneSelection,
): boolean {
	return mode === "always-ask" || selection.requiresReview === true;
}
```

Then in `renderContent`, replace the whole keep-choice block (from
`if (this.mode === "always-ask") {` through the two closing braces that end
the issue loop and the `if`):

```typescript
		if (this.mode === "always-ask") {
			for (const issue of this.issues) {
				const selection = issue.fixAction?.selection;
				if (!selection) continue;
				const group = contentEl.createDiv({ cls: "vi-keep-group" });
				group.createDiv({
					cls: "vi-keep-group-title",
					text: "Choose one file to keep",
				});
				for (const path of selection.candidatePaths) {
					const option = group.createEl("label", { cls: "vi-keep-option" });
					const radio = option.createEl("input", { type: "radio" });
					radio.name = `keep-${issue.fingerprint}`;
					radio.checked =
						this.selectedKeeps.get(issue.fingerprint) === path;
					radio.addEventListener("change", () => {
						this.selectedKeeps.set(issue.fingerprint, path);
						this.renderContent();
					});
					option.createSpan({ cls: "vi-keep-option-path", text: path });
				}
			}
		}
```

with:

```typescript
		for (const issue of this.issues) {
			const selection = issue.fixAction?.selection;
			if (!selection || !shouldAskForKeep(this.mode, selection)) continue;
			const group = contentEl.createDiv({ cls: "vi-keep-group" });
			group.createDiv({
				cls: "vi-keep-group-title",
				text: "Choose one file to keep",
			});
			const referencedPaths = selection.referencedPaths ?? [];
			if (referencedPaths.length >= 2) {
				group.createDiv({
					cls: "vi-keep-group-impact",
					text: `${referencedPaths.length} of ${selection.candidatePaths.length} files are referenced by notes: ${referencedPaths.join(", ")}. Choose which location to keep — references are never rewritten.`,
				});
			}
			for (const path of selection.candidatePaths) {
				const option = group.createEl("label", { cls: "vi-keep-option" });
				const radio = option.createEl("input", { type: "radio" });
				radio.name = `keep-${issue.fingerprint}`;
				radio.checked =
					this.selectedKeeps.get(issue.fingerprint) === path;
				radio.addEventListener("change", () => {
					this.selectedKeeps.set(issue.fingerprint, path);
					this.renderContent();
				});
				option.createSpan({ cls: "vi-keep-option-path", text: path });
			}
		}
```

No `styles.css` change is required: `vi-keep-group-impact` inherits the modal's
default paragraph styling, and Milestone 2.2 restyles impact presentation
properly.

- [ ] **Step 4: Run the confirm-modal tests**

```bash
npm test -- src/tests/confirm-modal.test.ts
```

Expected: PASS (5 tests).

---

### Task 6: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/duplicate-files.test.ts src/tests/fix-decisions.test.ts src/tests/confirm-modal.test.ts
```

Expected: PASS. Only hash-identical groups are confirmed duplicates
(`read-failed` and `cap-exceeded` files can never join a hash group); keep
selection is deterministic (highest inbound reference count, then path
order); referenced duplicate groups cannot be silently trashed in either
mode.

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0. The full run includes
`src/tests/scanner-precision.test.ts` (inventory unchanged at 18 lines — the
fixture's duplicate pair is unreferenced, so the automatic keep stays the
lexicographically first path) and `src/tests/main.test.ts` (untouched; the
optional selection fields keep its literals compiling with today's
behavior).

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/scanner/Issue.ts`,
`src/scanner/scanners/duplicate-files.ts`, `src/fix/fix-decisions.ts`,
`src/fix/confirm-modal.ts`, `src/tests/duplicate-files.test.ts`,
`src/tests/fix-decisions.test.ts`, `src/tests/confirm-modal.test.ts`. NOT
`src/scanner/reference-index.ts`, `ScanRunner.ts`, `ScanContext.ts`,
`src/scanner/issue-fingerprint.ts`, `src/snapshot/scan-snapshot.ts`,
`src/report/*`, `src/main.ts`, `src/tests/scanner-precision.test.ts`,
`src/tests/main.test.ts`, or `cli/`.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/Issue.ts src/scanner/scanners/duplicate-files.ts src/fix/fix-decisions.ts src/fix/confirm-modal.ts src/tests/duplicate-files.test.ts src/tests/fix-decisions.test.ts src/tests/confirm-modal.test.ts
git commit -m "fix: improve duplicate file decisions"
git push -u origin fix/duplicate-file-precision
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `fix: improve duplicate file decisions`, covering: behavior change
  (evidence gains hash states + aligned reference counts/mtimes; automatic
  keep prefers the most-referenced path with stable tie-break; review gating
  for multi-referenced groups in both modes); branch deviation from roadmap
  PR item 3 (orphan landed separately); non-goals (no reference rewriting, no
  Milestone 2 policy types, no fingerprint/COMPARISON_VERSION change —
  detection identity unchanged, so `COMPARISON_VERSION` stays `1`); focused
  tests run plus full gates; compatibility impact (selection fields additive
  and optional; automatic mode now asks once per review group; fingerprints
  stable so ignore-lists and snapshots survive); manual validation performed;
  remaining boundaries (reference index still excludes CSS, Dataview,
  publishing pipelines, external tools — keep decisions weigh only indexed
  references).

## Self-review checklist (completed during plan writing)

- Roadmap Task 1.3 requirements ↔ tasks: preserve size prefilter + size-capped SHA-256 ✓ (Task 3 keeps phases 1–3 and `duplicateHashMaxBytes`); `hash-confirmed`/`cap-exceeded`/`read-failed` evidence ✓ (Task 2 tests: warning `hashState`, candidate `hashStates` incl. both degraded cases; Task 3 `HashState` map); inbound reference counts + mtimes per file ✓ (`referenceCounts`/`mtimes` aligned by index with `relatedPaths`); automatic keep = highest inbound count, ties by stable path order ✓ (`pickAutomaticKeepPath` + tie-break test); multi-referenced groups show impact and require explicit review ✓ (scanner `requiresReview` + `nextStep`, `buildFixDecisionState` gate, modal impact line + radios via `shouldAskForKeep`, Confirm disabled until complete); no automatic reference rewrites ✓ (only `trash-file`; design doc states dangling links surface via broken-links next scan).
- Roadmap verification command reproduced in Task 6 Step 1 with the roadmap's expected outcome.
- No placeholders: every edit ships complete code; both full rewrites (`duplicate-files.ts`, `duplicate-files.test.ts`) and every precise replacement (`Issue.ts` type, `fix-decisions.ts` two hunks, `confirm-modal.ts` imports/helper/render block, both test-file append/factory edits) match the real current file contents.
- Type/name consistency verified against the codebase: `getInboundReference` and `ReferenceIndex` exported from `src/scanner/reference-index.ts`; `KeepOneSelection` in `src/scanner/Issue.ts`; `buildFixDecisionState(issues, mode, selectedKeeps)` and `getFreshFixAction(requested, fresh, decision)` signatures match `src/fix/fix-decisions.ts`; `DuplicateKeepMode = "always-ask" | "automatic"` from `src/settings/settings.ts`; `describeFinding(classification, why, nextStep, caveat?)` order matches `src/scanner/finding-presentation.ts`; `Issue.evidence` is `Record<string, string | number | boolean>` (all new fields are strings/numbers); `makeEmptyReferenceIndex()` matches the current helper; `hashContent`/`getBasename`/`getExtension`/`isIgnoredPath`/`formatSize` imports match today's scanner.
- Fingerprints: all three inputs byte-identical (`paths`/`nameCandidates`/`sizeCandidates` sorted joins — candidate paths are now pre-sorted, same hashed string); `COMPARISON_VERSION` untouched at `1` with the justification recorded in the design doc and the PR description.
