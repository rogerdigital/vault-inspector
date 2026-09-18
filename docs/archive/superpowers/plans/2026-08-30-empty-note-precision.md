# Empty Note Precision Implementation Plan (Milestone 1, Task 1.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The empty-notes scanner counts meaningful structures (internal links/embeds, task items, non-empty list items, non-empty fenced code blocks, and non-prose visible blocks like tables and images) independently from the prose word count; a note is reported only when it is at or below the word threshold AND has zero structures. Link-only MOCs, embed-only notes, and task notes stop being reported. Evidence gains `structureCount` and `inboundReferenceCount`; a stub with any inbound reference keeps its finding but loses its `trash-file` fix action. Fingerprints are unchanged.

**Architecture:** `countMeaningfulStructures` is a new pure export in the scanner file, operating on the same post-`stripFrontmatterAndTitle` body as `countWords`. Fix suppression mirrors the orphan scanner's coverage gating: the scanner conditionally spreads `fixAction` based on `getInboundReference(ctx.referenceIndex, ...)`. No changes to `Issue.ts`, `ScanContext.ts`, `ScanRunner.ts`, fix flows, or rendering.

**Tech Stack:** TypeScript, Vitest, hand-built `ReferenceIndex` test fixtures

Design doc: `docs/superpowers/specs/2026-08-30-empty-note-precision-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.4)

---

## Ground rules

- Branch: `fix/empty-note-precision`, cut from latest `main` (must include the merged reference-index, orphan, and duplicate PRs).
- One commit: `fix: recognize meaningful note structures`.
- Fingerprints MUST stay byte-identical: `generateFingerprint("empty-notes", file.path, {})`. Evidence and the structure gate never enter it; user ignore lists survive. `COMPARISON_VERSION` stays `1`.
- The precision fixture files (`src/tests/fixtures/precision-vault/**`) are the M0-frozen evidence base: DO NOT modify any fixture file. Only `src/tests/scanner-precision.test.ts` changes.
- Evidence values are scalars only (`string | number | boolean`); no arrays, no nested objects.
- Plain prose paragraphs deliberately count zero structures (the word count already measures them — counting them would hide every stub). Documented in the design doc and the code comment.
- Do not modify `src/scanner/Issue.ts`, `src/scanner/ScanContext.ts`, `src/scanner/ScanRunner.ts`, `src/scanner/reference-index.ts`, `src/scanner/finding-presentation.ts`, `src/scanner/issue-fingerprint.ts`, `src/fix/*`, `src/report/*`, `src/snapshot/*`, `src/main.ts`, `src/settings/*`, or `cli/`.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b fix/empty-note-precision
```

---

### Task 2: Rewrite the empty-notes unit tests first (TDD)

**Files:**
- Modify: `src/tests/empty-notes.test.ts` (full rewrite)

The rewritten suite seeds `referenceIndex` (the current `makeCtx` omits the
field — the scanner would crash on `getInboundReference` otherwise) and pins
the structure gate, evidence, and fix suppression. Replace the entire file
with:

```typescript
import { describe, it, expect } from "vitest";
import {
	emptyNotesScanner,
	countWords,
	countMeaningfulStructures,
} from "../scanner/scanners/empty-notes";
import type { ScanContext } from "../scanner/ScanContext";
import type { ReferenceIndex } from "../scanner/reference-index";
import { makeEmptyReferenceIndex } from "../scanner/reference-index";

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["empty-notes"]),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		emptyNoteWordThreshold: 5,
		watchedTags: [],
		ignoredFolders: [],
		ignoredProperties: [],
		referenceIndex: makeEmptyReferenceIndex(),
		...overrides,
	} as ScanContext;
}

function makeIndex(referenceCounts: Record<string, number>): ReferenceIndex {
	return {
		inboundByPath: new Map(
			Object.entries(referenceCounts).map(([path, count]) => [
				path,
				{ count, kinds: ["note-link"], sources: ["notes/hub.md"] },
			]),
		),
		canvasFiles: [],
		coverageFailures: [],
		coverageComplete: true,
	};
}

describe("emptyNotesScanner", () => {
	it("detects completely empty notes", async () => {
		const file = { path: "empty.md", stat: { size: 0, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("Empty note");
		expect(issues[0].severity).toBe("warning");
		expect(issues[0]).toMatchObject({
			classification: "candidate",
			evidence: {
				wordCount: 0,
				structureCount: 0,
				inboundReferenceCount: 0,
			},
			explanation: {
				why: "The note contains 0 meaningful words and no meaningful structures (links, embeds, tasks, list items, or code blocks), at or below the configured threshold of 5.",
				caveat: "Intentional placeholders, index notes, and generated stubs can be valid.",
				nextStep: "Add meaningful content, ignore the finding, or move the note to trash after review.",
			},
		});
	});

	it("detects notes with only frontmatter", async () => {
		const file = { path: "fm-only.md", stat: { size: 50, mtime: 1000 } } as any;
		const content = "---\ntitle: Test\n---\n";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("Empty note");
	});

	it("detects notes with only frontmatter and title", async () => {
		const file = { path: "title-only.md", stat: { size: 50, mtime: 1000 } } as any;
		const content = "---\ntags: test\n---\n# My Title\n";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("Empty note");
	});

	it("does not flag notes with content beyond title", async () => {
		const file = { path: "normal.md", stat: { size: 200, mtime: 1000 } } as any;
		// 10 words — above the default threshold of 5.
		const content = "# Title\nThis note has plenty of real content written in it.";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not flag link-only MOCs", async () => {
		const file = { path: "short-moc.md", stat: { size: 40, mtime: 1000 } } as any;
		const content = "# Short MOC\n\n[[target]] [[sibling-note]]";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not flag embed-only notes", async () => {
		const file = { path: "embed.md", stat: { size: 30, mtime: 1000 } } as any;
		const content = "# Embed\n\n![[photo.jpg]]";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not flag task-only notes", async () => {
		const file = { path: "tasks.md", stat: { size: 30, mtime: 1000 } } as any;
		const content = "# Tasks\n\n- [ ] Fix docs";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not flag list-only notes", async () => {
		const file = { path: "list.md", stat: { size: 30, mtime: 1000 } } as any;
		const content = "# List\n\n- one\n- two";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not flag notes whose only content is a non-empty code block", async () => {
		const file = { path: "code.md", stat: { size: 60, mtime: 1000 } } as any;
		const content = "# Code\n\n```js\nconst answer = 42;\n```";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not flag prose stubs that contain a link or task — structures rescue the note", async () => {
		const file = { path: "mixed.md", stat: { size: 40, mtime: 1000 } } as any;
		const linked = "# Stub\n\nsee [[target]]";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => linked } as any,
		});
		expect(await emptyNotesScanner.scan(ctx)).toHaveLength(0);
	});

	it("still flags prose stubs with zero structures", async () => {
		const file = { path: "stub-msg.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "stub" } as any, // 1 word, 0 structures
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain("1 word");
		expect(issues[0].evidence.structureCount).toBe(0);
	});

	it("skips files in ignored folders", async () => {
		const file = { path: "templates/empty.md", stat: { size: 0, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			ignoredFolders: ["templates"],
			vault: { cachedRead: async () => "" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("includes a fix action only for unreferenced stubs", async () => {
		const file = { path: "empty.md", stat: { size: 0, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues[0].fixAction).toBeDefined();
		expect(issues[0].fixAction!.kind).toBe("trash-file");
		expect(issues[0].fixAction!.targetPaths).toEqual(["empty.md"]);
	});

	it("keeps the finding but suppresses the fix action for referenced stubs", async () => {
		const file = { path: "linked-stub.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			referenceIndex: makeIndex({ "linked-stub.md": 3 }),
			vault: { cachedRead: async () => "stub" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.inboundReferenceCount).toBe(3);
		expect(issues[0].fixAction).toBeUndefined();
		expect(issues[0].explanation.nextStep).toBe(
			"This stub is referenced by 3 inbound links. Review why it is referenced before adding content or deleting it.",
		);
	});

	it("uses singular wording for a single inbound reference", async () => {
		const file = { path: "linked-stub.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			referenceIndex: makeIndex({ "linked-stub.md": 1 }),
			vault: { cachedRead: async () => "stub" } as any,
		});
		const [issue] = await emptyNotesScanner.scan(ctx);
		expect(issue.explanation.nextStep).toBe(
			"This stub is referenced by 1 inbound link. Review why it is referenced before adding content or deleting it.",
		);
	});

	it("flags short Chinese content at or below threshold", async () => {
		// "今天天气好" = 5 CJK chars = 5 words, 0 structures at default threshold 5 → flagged.
		const file = { path: "short-cjk.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "今天天气好" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.wordCount).toBe(5);
		expect(issues[0].evidence.structureCount).toBe(0);
	});

	it("does not flag Chinese content above threshold", async () => {
		// "今天天气真好" = 6 CJK chars = 6 words > default threshold 5 → not flagged.
		const file = { path: "ok-cjk.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "今天天气真好" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not flag a CJK note whose only content is a CJK link", async () => {
		const file = { path: "cjk-moc.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "[[目标笔记]]" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("flags short Latin content at or below threshold", async () => {
		// "hi there" = 2 words ≤ default threshold 5 → flagged.
		const file = { path: "short-en.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "# Note\nhi there" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.wordCount).toBe(2);
	});

	it("respects emptyNoteWordThreshold setting (regression for threshold never taking effect)", async () => {
		const file = { path: "stub.md", stat: { size: 30, mtime: 1000 } } as any;
		const content = "# Note\nthree word stub"; // 3 words, 0 structures
		const read = async () => content;

		// Threshold 2: 3 words > 2 → not flagged.
		const lowCtx = makeCtx({
			markdownFiles: [file],
			emptyNoteWordThreshold: 2,
			vault: { cachedRead: read } as any,
		});
		expect(await emptyNotesScanner.scan(lowCtx)).toHaveLength(0);

		// Threshold 3: 3 words ≤ 3 → flagged.
		const highCtx = makeCtx({
			markdownFiles: [file],
			emptyNoteWordThreshold: 3,
			vault: { cachedRead: read } as any,
		});
		expect(await emptyNotesScanner.scan(highCtx)).toHaveLength(1);
	});

	it("produces stable fingerprints when reference counts change", async () => {
		const file = { path: "stub.md", stat: { size: 30, mtime: 1000 } } as any;
		const base = {
			markdownFiles: [file],
			vault: { cachedRead: async () => "stub" } as any,
		};
		const unreferenced = await emptyNotesScanner.scan(makeCtx(base));
		const referenced = await emptyNotesScanner.scan(
			makeCtx({ ...base, referenceIndex: makeIndex({ "stub.md": 2 }) }),
		);
		expect(referenced[0].fingerprint).toBe(unreferenced[0].fingerprint);
	});
});

describe("countWords", () => {
	it("counts empty/whitespace as zero", () => {
		expect(countWords("")).toBe(0);
		expect(countWords("   \n\t  ")).toBe(0);
	});

	it("counts Latin words by whitespace", () => {
		expect(countWords("hello world")).toBe(2);
		expect(countWords("one")).toBe(1);
	});

	it("counts each CJK character as one word", () => {
		expect(countWords("今天天气")).toBe(4);
	});

	it("sums mixed CJK and Latin correctly", () => {
		// "hello world 世界" = 2 Latin words + 2 CJK chars = 4
		expect(countWords("hello world 世界")).toBe(4);
	});

	it("ignores punctuation and markdown markers", () => {
		// "- [ ] task" = 2 words ("task" and "[?]") — brackets stand alone as a token.
		// This documents current behavior: symbols form whitespace-delimited tokens.
		expect(countWords("task done")).toBe(2);
	});

	it("counts Japanese kana and Hangul as per-character", () => {
		expect(countWords("こんにちは")).toBe(5); // Hiragana
		expect(countWords("안녕하세요")).toBe(5); // Hangul
	});
});

describe("countMeaningfulStructures", () => {
	it("counts zero for empty and plain prose bodies", () => {
		expect(countMeaningfulStructures("")).toBe(0);
		expect(countMeaningfulStructures("   \n\t  ")).toBe(0);
		// Prose is measured by countWords; it is deliberately not a structure.
		expect(countMeaningfulStructures("Real stub note.")).toBe(0);
		expect(countMeaningfulStructures("你好")).toBe(0);
	});

	it("counts every internal link and embed occurrence", () => {
		expect(countMeaningfulStructures("[[target]] [[sibling-note]]")).toBe(2);
		expect(countMeaningfulStructures("![[photo.jpg]]")).toBe(1);
		expect(countMeaningfulStructures("[[target#Section One]]")).toBe(1);
		expect(countMeaningfulStructures("[[目标笔记]]")).toBe(1);
	});

	it("counts task items once each, checked or unchecked", () => {
		expect(countMeaningfulStructures("- [ ] Fix docs")).toBe(1);
		expect(countMeaningfulStructures("- [x] Done\n* [X] Also done\n1. [ ] ordered")).toBe(3);
	});

	it("counts non-empty list items but not bare markers", () => {
		expect(countMeaningfulStructures("- one\n- two\n+ three")).toBe(3);
		expect(countMeaningfulStructures("1. first\n2) second")).toBe(2);
		expect(countMeaningfulStructures("-\n- \n")).toBe(0);
	});

	it("counts a non-empty fenced code block once, not per line", () => {
		const body = "```js\nconst a = 1;\nconst b = 2;\n```";
		expect(countMeaningfulStructures(body)).toBe(1);
		expect(countMeaningfulStructures("```\n\n```")).toBe(0); // empty block
		expect(countMeaningfulStructures("~~~\ncode\n~~~")).toBe(1); // tilde fences
	});

	it("counts unterminated fence content as zero structures", () => {
		// No closing fence → no block structure; countWords still measures the text.
		expect(countMeaningfulStructures("```\nconst a = 1;")).toBe(0);
	});

	it("counts a table block once and Markdown/HTML images individually", () => {
		expect(countMeaningfulStructures("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(1);
		expect(countMeaningfulStructures("![alt](photo.jpg)")).toBe(1);
		expect(countMeaningfulStructures('<img src="photo.jpg">')).toBe(1);
	});

	it("sums mixed content across categories", () => {
		const body = "- [[target]]\n- [ ] task\nprose line\n\n| a |\n|---|";
		// 1 link + 2 list items (the link item and the task) + 1 table = 4.
		expect(countMeaningfulStructures(body)).toBe(4);
	});
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/empty-notes.test.ts
```

Expected: FAIL — `countMeaningfulStructures` is not exported; the scanner
reports link-only/embed-only/task-only notes today, emits no
`structureCount`/`inboundReferenceCount` evidence, and attaches `trash-file`
regardless of inbound references.

---

### Task 3: Rewrite the scanner

**Files:**
- Modify: `src/scanner/scanners/empty-notes.ts` (full rewrite)

- [ ] **Step 1: Replace the entire scanner file with:**

```typescript
import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";
import { getInboundReference } from "../reference-index";

export const emptyNotesScanner = {
	id: "empty-notes" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];
		const index = ctx.referenceIndex;

		for (const file of ctx.markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const content = await ctx.vault.cachedRead(file);
			const body = stripFrontmatterAndTitle(content);
			const wordCount = countWords(body);
			const structureCount = countMeaningfulStructures(body);
			const inboundReferenceCount =
				getInboundReference(index, file.path)?.count ?? 0;

			if (wordCount <= ctx.emptyNoteWordThreshold && structureCount === 0) {
				issues.push({
					scannerId: "empty-notes",
					severity: "warning",
					title: "Empty note",
					message:
						wordCount === 0
							? "This note has no content besides a title"
							: `This note only has ${wordCount} word${wordCount > 1 ? "s" : ""} (likely a stub)`,
					primaryPath: file.path,
					relatedPaths: [],
					evidence: {
						size: file.stat.size,
						wordCount,
						structureCount,
						inboundReferenceCount,
					},
					...describeFinding(
						"candidate",
						`The note contains ${wordCount} meaningful word${wordCount === 1 ? "" : "s"} and no meaningful structures (links, embeds, tasks, list items, or code blocks), at or below the configured threshold of ${ctx.emptyNoteWordThreshold}.`,
						inboundReferenceCount > 0
							? `This stub is referenced by ${inboundReferenceCount} inbound link${inboundReferenceCount === 1 ? "" : "s"}. Review why it is referenced before adding content or deleting it.`
							: "Add meaningful content, ignore the finding, or move the note to trash after review.",
						"Intentional placeholders, index notes, and generated stubs can be valid.",
					),
					fingerprint: generateFingerprint("empty-notes", file.path, {}),
					// Delete eligibility requires zero inbound references: a
					// referenced stub may be a deliberate index entry, so it
					// stays reviewable and out of bulk-delete flows.
					...(inboundReferenceCount === 0
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
		}

		return issues;
	},
};

function stripFrontmatterAndTitle(content: string): string {
	let text = content;
	if (text.startsWith("---")) {
		const end = text.indexOf("\n---", 3);
		if (end !== -1) {
			text = text.slice(end + 4);
		}
	}
	text = text.replace(/^#+\s+.*$/m, "");
	return text;
}

/**
 * Count words in note body with CJK awareness.
 *
 * CJK characters (Han, Hiragana, Katakana, Hangul) each count as one word,
 * since CJK text has no word separators. Latin/other scripts are split on
 * whitespace into words. Mixed content is summed correctly.
 *
 * Example: "hello world 世界" = 1 (hello) + 1 (world) + 2 (世, 界) = 4 words.
 */
export function countWords(text: string): number {
	let count = 0;
	// Matches a run of CJK ideographs/syllables — each char is its own "word".
	const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
	for (const match of text.matchAll(cjkPattern)) {
		void match;
		count++;
	}
	// Remove CJK chars, then count whitespace-separated words in what remains.
	const withoutCjk = text.replace(cjkPattern, " ");
	for (const segment of withoutCjk.split(/\s+/)) {
		if (segment.length > 0) count++;
	}
	return count;
}

/**
 * Count meaningful structures in a note body (after frontmatter and title
 * removal), independently from the prose word count:
 *
 * - internal links and embeds (every `[[...]]` occurrence);
 * - Markdown task items (`- [ ]` / `- [x]`, bullet or ordered);
 * - non-empty list items (bullet or ordered);
 * - fenced code blocks with at least one non-blank inner line (once per
 *   block; an unterminated fence counts nothing — its text is already
 *   measured by countWords);
 * - other non-prose visible blocks: table blocks (once per run of `|` rows),
 *   Markdown images, and `<img>` lines.
 *
 * Plain prose paragraphs deliberately count ZERO structures: countWords
 * already measures them, so counting them would make every prose stub
 * "structural" and defeat stub detection entirely. structureCount is a count
 * of meaning indicators (a link inside a list item is visible in both
 * categories), and only `=== 0` gates empty-note reporting.
 */
export function countMeaningfulStructures(body: string): number {
	let count = 0;
	// Internal links and embeds, wherever they appear.
	for (const match of body.matchAll(/\[\[[^\]]+\]\]/g)) {
		void match;
		count++;
	}

	let inFence = false;
	let fenceHasContent = false;
	let inTable = false;
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (/^(```|~~~)/.test(trimmed)) {
			if (inFence && fenceHasContent) count++;
			inFence = !inFence;
			fenceHasContent = false;
			continue;
		}
		if (inFence) {
			if (trimmed !== "") fenceHasContent = true;
			continue;
		}
		if (trimmed === "") continue;
		if (/^\|.*\|/.test(trimmed)) {
			if (!inTable) {
				count++;
				inTable = true;
			}
			continue;
		}
		inTable = false;
		if (/^[-*+]\s+\[[ xX]\]/.test(trimmed)) {
			count++;
			continue;
		}
		if (/^\d+[.)]\s+\[[ xX]\]/.test(trimmed)) {
			count++;
			continue;
		}
		if (/^[-*+]\s+\S/.test(trimmed)) {
			count++;
			continue;
		}
		if (/^\d+[.)]\s+\S/.test(trimmed)) {
			count++;
			continue;
		}
		if (/^!\[[^\]]*\]\([^)]*\)/.test(trimmed) || /<img\b/.test(trimmed)) {
			count++;
		}
		// Plain prose line: not a structure — countWords covers it.
	}
	return count;
}
```

Design notes for reviewers:

- The detection rule is `wordCount <= threshold && structureCount === 0`:
  title-only, frontmatter-only, and genuine-empty notes keep
  `structureCount === 0`, while link/embed/task/list/code notes exceed zero
  regardless of word count.
- The fingerprint input stays `{}` — evidence, the structure gate, and fix
  suppression never enter it, so fingerprints of surviving findings are
  byte-identical and user ignore lists survive.
- `nextStep` swaps to the review wording when `inboundReferenceCount > 0`;
  the finding, severity, and classification never change.

- [ ] **Step 2: Run the scanner unit tests**

```bash
npm test -- src/tests/empty-notes.test.ts
```

Expected: PASS (35 tests: 21 scanner + 6 countWords + 8
countMeaningfulStructures). `src/tests/scanner-precision.test.ts` still
fails (next task): its inventory still expects the three FP lines.

---

### Task 4: Update the precision suite

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

Fixture files under `src/tests/fixtures/precision-vault/` stay unchanged —
they are the M0-frozen evidence base.

- [ ] **Step 1: Drop the three false-positive inventory lines**

In `EXPECTED_INVENTORY`, delete exactly these three entries:

```typescript
	"empty-notes | warning | candidate | notes/empty/embed-only.md | This note only has 1 word (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/short-link-moc.md | This note only has 2 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/task-note.md | This note only has 5 words (likely a stub)",
```

The inventory drops from 18 to 15 lines: these three findings no longer
exist because their notes now carry meaningful structures.

- [ ] **Step 2: Replace the eight-stub test with the five-stub and fix-gating tests**

Replace the whole `it("reports the eight stub notes as warning candidates with trash actions", ...)` block:

```typescript
		it("reports the eight stub notes as warning candidates with trash actions", async () => {
			const { issues } = await scanFixtureVault();
			const empty = issues.filter((issue) => issue.scannerId === "empty-notes");
			expect(empty.map((issue) => issue.primaryPath).sort()).toEqual([
				"notes/empty/cjk-stub.md",
				"notes/empty/embed-only.md",
				"notes/empty/frontmatter-only.md",
				"notes/empty/genuine-empty.md",
				"notes/empty/short-link-moc.md",
				"notes/empty/stub.md",
				"notes/empty/task-note.md",
				"notes/empty/title-only.md",
			]);
			expect(empty.every((issue) => issue.severity === "warning")).toBe(true);
			expect(empty.every((issue) => issue.classification === "candidate")).toBe(true);
			expect(empty.every((issue) => issue.fixAction?.kind === "trash-file")).toBe(true);
		});
```

with:

```typescript
		it("reports the five stub notes as warning candidates with zero structures", async () => {
			const { issues } = await scanFixtureVault();
			const empty = issues.filter((issue) => issue.scannerId === "empty-notes");
			expect(empty.map((issue) => issue.primaryPath).sort()).toEqual([
				"notes/empty/cjk-stub.md",
				"notes/empty/frontmatter-only.md",
				"notes/empty/genuine-empty.md",
				"notes/empty/stub.md",
				"notes/empty/title-only.md",
			]);
			expect(empty.every((issue) => issue.severity === "warning")).toBe(true);
			expect(empty.every((issue) => issue.classification === "candidate")).toBe(true);
			expect(empty.every((issue) => issue.evidence.structureCount === 0)).toBe(true);
		});

		it("offers trash only for the unreferenced stub — referenced stubs stay reviewable", async () => {
			const { issues } = await scanFixtureVault();
			const empty = issues.filter((issue) => issue.scannerId === "empty-notes");
			const byPath = new Map(empty.map((issue) => [issue.primaryPath, issue]));
			// link-only-moc.md links to these four stubs: their findings stay,
			// but the trash action is suppressed (inbound reference count > 0).
			for (const path of [
				"notes/empty/frontmatter-only.md",
				"notes/empty/genuine-empty.md",
				"notes/empty/stub.md",
				"notes/empty/title-only.md",
			]) {
				expect(byPath.get(path)?.fixAction).toBeUndefined();
				expect(byPath.get(path)?.evidence.inboundReferenceCount).toBe(1);
			}
			expect(byPath.get("notes/empty/cjk-stub.md")?.fixAction).toMatchObject({
				kind: "trash-file",
				targetPaths: ["notes/empty/cjk-stub.md"],
			});
			expect(byPath.get("notes/empty/cjk-stub.md")?.evidence.inboundReferenceCount).toBe(0);
		});
```

- [ ] **Step 3: Extend the structural-exclusion test**

Replace the whole `it("keeps structural notes out of the findings — MOC, code note pass today", ...)` block:

```typescript
		it("keeps structural notes out of the findings — MOC, code note pass today", async () => {
			const { issues } = await scanFixtureVault();
			const emptyPaths = issues
				.filter((issue) => issue.scannerId === "empty-notes")
				.map((issue) => issue.primaryPath);
			expect(emptyPaths).not.toContain("notes/empty/link-only-moc.md");
			expect(emptyPaths).not.toContain("notes/empty/code-note.md");
		});
```

with:

```typescript
		it("keeps structural notes out of the findings — MOCs, embeds, tasks, code", async () => {
			const { issues } = await scanFixtureVault();
			const emptyPaths = issues
				.filter((issue) => issue.scannerId === "empty-notes")
				.map((issue) => issue.primaryPath);
			expect(emptyPaths).not.toContain("notes/empty/link-only-moc.md");
			expect(emptyPaths).not.toContain("notes/empty/code-note.md");
			// Former false positives, now excluded by the structure gate.
			expect(emptyPaths).not.toContain("notes/empty/short-link-moc.md");
			expect(emptyPaths).not.toContain("notes/empty/embed-only.md");
			expect(emptyPaths).not.toContain("notes/empty/task-note.md");
		});
```

- [ ] **Step 4: Replace the word-count pins for the vanished false positives**

Replace the whole `it("pins the known false positives with their word counts", ...)` block:

```typescript
		it("pins the known false positives with their word counts", async () => {
			const { issues } = await scanFixtureVault();
			const wordCountByPath = new Map(
				issues
					.filter((issue) => issue.scannerId === "empty-notes")
					.map((issue) => [issue.primaryPath, issue.evidence.wordCount]),
			);
			// Link-only, embed-only, and task-only notes are reported today
			// purely by prose word count (Milestone 1.4 target).
			expect(wordCountByPath.get("notes/empty/short-link-moc.md")).toBe(2);
			expect(wordCountByPath.get("notes/empty/embed-only.md")).toBe(1);
			expect(wordCountByPath.get("notes/empty/task-note.md")).toBe(5);
			expect(wordCountByPath.get("notes/empty/cjk-stub.md")).toBe(2);
			expect(wordCountByPath.get("notes/empty/stub.md")).toBe(3);
		});
```

with:

```typescript
		it("pins the remaining stub word counts", async () => {
			const { issues } = await scanFixtureVault();
			const empty = issues.filter((issue) => issue.scannerId === "empty-notes");
			const wordCountByPath = new Map(
				empty.map((issue) => [issue.primaryPath, issue.evidence.wordCount]),
			);
			// Rationale for removing the former pins: short-link-moc (2),
			// embed-only (1), and task-note (5) now produce NO empty-notes
			// finding, so their word counts are no longer observable through
			// this scanner. The structural-exclusion test above carries the
			// assertion that they are not reported.
			expect(wordCountByPath.get("notes/empty/cjk-stub.md")).toBe(2);
			expect(wordCountByPath.get("notes/empty/stub.md")).toBe(3);
		});
```

- [ ] **Step 5: Run the precision suite**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS. Inventory snapshot matches at 15 lines; the five remaining
stub findings match; the four MOC-linked stubs have no `fixAction` while
`cjk-stub.md` keeps `trash-file`; repeat-scan fingerprints are unchanged
(fingerprint inputs never included evidence).

---

### Task 5: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/empty-notes.test.ts src/tests/scanner-precision.test.ts
```

Expected: PASS. Structural notes (link-only/embed-only/task-only MOCs, list
notes, code notes) are preserved while genuine empty notes and prose stubs
are still detected; referenced stubs stay reviewable without a trash action.

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0. No other suite depends on empty-notes fix actions or
evidence shape (`src/tests/main.test.ts` constructs its own issue literals
and is untouched; report renderers read `wordCount` only, which is
unchanged, and handle absent `fixAction` generically).

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/scanner/scanners/empty-notes.ts`,
`src/tests/empty-notes.test.ts`, `src/tests/scanner-precision.test.ts`. NOT
any fixture file under `src/tests/fixtures/precision-vault/`, nor
`src/scanner/Issue.ts`, `src/scanner/ScanContext.ts`,
`src/scanner/ScanRunner.ts`, `src/scanner/reference-index.ts`, `src/fix/*`,
`src/report/*`, `src/snapshot/*`, `src/main.ts`, `src/settings/*`, or `cli/`.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/scanners/empty-notes.ts src/tests/empty-notes.test.ts src/tests/scanner-precision.test.ts
git commit -m "fix: recognize meaningful note structures"
git push -u origin fix/empty-note-precision
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `fix: recognize meaningful note structures`, covering: behavior change
  (structure gate — links/embeds, tasks, list items, non-empty code fences,
  tables/images count as meaningful content; reported only when word count
  ≤ threshold AND structureCount = 0; three precision-fixture FPs vanish,
  inventory 18 → 15); fix suppression (any inbound reference > 0 withholds
  the trash-file action and swaps nextStep to a review message — mirrors the
  orphan coverage-gating precedent); evidence additions (`structureCount`,
  `inboundReferenceCount`, scalar-only); fingerprint stability
  (`generateFingerprint("empty-notes", path, {})` unchanged — ignore lists
  survive; `COMPARISON_VERSION` stays `1`, old snapshot diffs show the three
  FPs resolved, which is accurate); CJK coverage kept (CJK chars still count
  as words; CJK link text counts as structure); fixture files untouched
  (M0-frozen evidence base); focused tests plus full gates run.

## Self-review checklist (completed during plan writing)

- Roadmap Task 1.4 requirements ↔ tasks: count links/embeds, task items, non-empty list items, non-empty fenced code blocks, and other visible block content ✓ (Task 3 `countMeaningfulStructures`, with the prose-exclusion interpretation documented in the design doc — counting paragraphs would hide every stub, and `stub.md`/`cjk-stub.md` are the proof); link-only MOCs / embed-only / task notes not reported ✓ (Task 2 tests + Task 4 exclusion test); title-only and frontmatter-only remain candidates ✓ (Task 2 tests + Task 4 five-stub list); evidence includes word count, structure count, inbound reference count ✓ (`wordCount`, `structureCount`, `inboundReferenceCount` — all scalars); referenced stub stays reviewable, not low-risk bulk-delete ✓ (`inboundReferenceCount > 0` suppresses `fixAction`, `nextStep` names the references, mirroring the orphan coverage-gating precedent); CJK behavior covered ✓ (CJK word-count tests kept; CJK-link and CJK-prose structure tests added).
- Roadmap verification command reproduced in Task 5 Step 1 with the roadmap's expected outcome.
- No placeholders: the two full rewrites (`empty-notes.ts`, `empty-notes.test.ts`) ship complete code, and all four precision-suite edits quote the exact current file contents before replacement (verified against `src/tests/scanner-precision.test.ts` lines 171–212 and 31–41).
- Type/name consistency verified against the codebase: `getInboundReference` exported from `src/scanner/reference-index.ts`; `ctx.referenceIndex` exists on `ScanContext` (populated by `ScanRunner` — orphan scanner already consumes it); `describeFinding(classification, why, nextStep, caveat?)` order matches `src/scanner/finding-presentation.ts`; `Issue.evidence` is `Record<string, string | number | boolean>` (new fields are numbers); `emptyNoteWordThreshold` is an existing `ScanContext` field; the conditional `fixAction` spread matches the orphan scanner's established pattern.
- Inventory delta is exactly three deleted lines (embed-only, short-link-moc, task-note) — 18 → 15; no other inventory line changes (severity/classification/message of surviving findings unchanged; evidence and fixAction are not part of `inventoryLine`).
- Fingerprints byte-identical; `COMPARISON_VERSION` stays `1` with the justification recorded in the design doc and the PR description.
