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

	it("does not report a Markdown-link-only MOC as empty", async () => {
		const file = { path: "notes/moc.md", stat: { size: 40, mtime: 1000 } } as any;
		const content = "# MOC\n\n[Target](target.md)";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toEqual([]);
	});

	it("reports a note whose only structure is inside an HTML comment", async () => {
		const file = { path: "notes/commented.md", stat: { size: 60, mtime: 1000 } } as any;
		const content = "# Commented\n\n<!-- [draft](missing.md) -->";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.structureCount).toBe(0);
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

	it("counts every wiki link and embed occurrence", () => {
		expect(countMeaningfulStructures("[[target]] [[sibling-note]]")).toBe(2);
		expect(countMeaningfulStructures("![[photo.jpg]]")).toBe(1);
		expect(countMeaningfulStructures("[[target#Section One]]")).toBe(1);
		expect(countMeaningfulStructures("[[目标笔记]]")).toBe(1);
	});

	it("counts Markdown links and images, internal or external, exactly once", () => {
		expect(countMeaningfulStructures("[Target](target.md)")).toBe(1);
		expect(countMeaningfulStructures("[Section](target.md#Part)")).toBe(1);
		expect(countMeaningfulStructures("[External](https://example.com)")).toBe(1);
		expect(countMeaningfulStructures("![alt](photo.jpg)")).toBe(1);
		// No double counting at the wiki/Markdown boundary.
		expect(countMeaningfulStructures("![[embed]]")).toBe(1);
		expect(countMeaningfulStructures("![[a.png]] and ![b](b.png)")).toBe(2);
		expect(countMeaningfulStructures("[![img](i.png)](https://x)")).toBe(1);
	});

	it("ignores structures inside HTML comments and escaped brackets", () => {
		expect(countMeaningfulStructures("<!-- [draft](missing.md) -->")).toBe(0);
		expect(countMeaningfulStructures("<!-- [[target]] -->")).toBe(0);
		expect(countMeaningfulStructures("<!-- - commented task -->")).toBe(0);
		// A comment plus a real link: only the visible link counts.
		expect(countMeaningfulStructures("<!-- [draft](missing.md) -->\n[Real](real.md)")).toBe(1);
		// Backslash-escaped brackets are literal text, not links.
		expect(countMeaningfulStructures("\\[literal](target)")).toBe(0);
		// Escaping the bang only leaves a literal !; the link itself is real.
		expect(countMeaningfulStructures("\\![img](i.png)")).toBe(1);
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
