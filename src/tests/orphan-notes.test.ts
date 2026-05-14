import { describe, it, expect } from "vitest";
import { orphanNotesScanner } from "../scanner/scanners/orphan-notes";
import type { ScanContext } from "../scanner/ScanContext";

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["orphan-notes"]),
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

describe("orphanNotesScanner", () => {
	it("detects notes with no inbound links", () => {
		const md1 = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const md2 = { path: "b.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [md1, md2],
			allFiles: [md1, md2],
			filePathIndex: new Set(["a.md", "b.md"]),
			metadataCache: {
				getFileCache: () => ({ links: [], embeds: [] }),
			} as any,
		});
		const issues = orphanNotesScanner.scan(ctx);
		expect(issues).toHaveLength(2);
		expect(issues[0].scannerId).toBe("orphan-notes");
	});

	it("does not report notes that are linked to", () => {
		const md1 = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const md2 = { path: "b.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [md1, md2],
			allFiles: [md1, md2],
			filePathIndex: new Set(["a.md", "b.md"]),
			metadataCache: {
				getFileCache: (file: any) => {
					if (file.path === "a.md") return { links: [{ link: "b" }], embeds: [] };
					return { links: [], embeds: [] };
				},
				resolvedLinks: { "a.md": { b: "b.md" } },
			} as any,
		});
		const issues = orphanNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].primaryPath).toBe("a.md");
	});

	it("skips files in ignored folders", () => {
		const md = { path: "templates/t.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md],
			filePathIndex: new Set(["templates/t.md"]),
			ignoredFolders: ["templates"],
			metadataCache: { getFileCache: () => ({ links: [], embeds: [] }) } as any,
		});
		const issues = orphanNotesScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not flag notes linked via file path with .md extension", () => {
		const md1 = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const md2 = { path: "b.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [md1, md2],
			allFiles: [md1, md2],
			filePathIndex: new Set(["a.md", "b.md"]),
			metadataCache: {
				getFileCache: (file: any) => {
					if (file.path === "a.md") return { links: [{ link: "b.md" }], embeds: [] };
					return { links: [], embeds: [] };
				},
			} as any,
		});
		const issues = orphanNotesScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].primaryPath).toBe("a.md");
	});

	it("has no fix action (orphan notes need human judgment)", () => {
		const md = { path: "lonely.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md],
			filePathIndex: new Set(["lonely.md"]),
			metadataCache: { getFileCache: () => ({ links: [], embeds: [] }) } as any,
		});
		const issues = orphanNotesScanner.scan(ctx);
		expect(issues[0].fixAction).toBeUndefined();
	});
});
