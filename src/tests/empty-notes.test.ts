import { describe, it, expect } from "vitest";
import { emptyNotesScanner } from "../scanner/scanners/empty-notes";
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

	it("detects stub notes below word threshold", async () => {
		const file = { path: "stub.md", stat: { size: 30, mtime: 1000 } } as any;
		const content = "---\ntags: test\n---\nHello world";
		const ctx = makeCtx({
			markdownFiles: [file],
			vault: { cachedRead: async () => content } as any,
		});
		const issues = await emptyNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("Stub note");
		expect(issues[0].severity).toBe("info");
	});

	it("does not flag notes above word threshold", async () => {
		const file = { path: "normal.md", stat: { size: 200, mtime: 1000 } } as any;
		const content = "This is a note with enough words to pass the threshold easily today";
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

	it("includes fix action for empty notes", async () => {
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
});
