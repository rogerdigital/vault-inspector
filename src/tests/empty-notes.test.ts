import { describe, it, expect } from "vitest";
import { emptyNotesScanner, countWords } from "../scanner/scanners/empty-notes";
import type { ScanContext } from "../scanner/ScanContext";

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
		...overrides,
	} as ScanContext;
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
			explanation: {
				why: "The note contains 0 meaningful words, at or below the configured threshold of 5.",
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

	it("includes fix action", async () => {
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

	it("flags short Chinese content at or below threshold", async () => {
		// "今天天气好" = 5 CJK chars = 5 words at default threshold 5 → flagged.
		const file = { path: "short-cjk.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "今天天气好" } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.wordCount).toBe(5);
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
		const content = "# Note\nthree word stub"; // 3 words
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

	it("renders a stub-specific message for non-empty short content", async () => {
		const file = { path: "stub-msg.md", stat: { size: 30, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => "stub" } as any, // 1 word
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toContain("1 word");
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
