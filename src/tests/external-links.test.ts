import { describe, it, expect, vi } from "vitest";
import { requestUrl } from "obsidian";
import { externalLinksScanner } from "../scanner/scanners/external-links";
import type { ScanContext } from "../scanner/ScanContext";

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["external-links"]),
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

describe("externalLinksScanner", () => {
	it("reports dead external links (HTTP 404)", async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as any);
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "https://example.com/dead" }],
					embeds: [],
				}),
			} as any,
		});
		const issues = await externalLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.status).toBe(404);
	});

	it("does not report healthy links (HTTP 200)", async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 200 } as any);
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "https://example.com/good" }],
					embeds: [],
				}),
			} as any,
		});
		const issues = await externalLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips internal links", async () => {
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "some-note" }, { link: "folder/another" }],
					embeds: [],
				}),
			} as any,
		});
		const issues = await externalLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files in ignored folders", async () => {
		const file = { path: "archive/old.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			ignoredFolders: ["archive"],
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "https://dead.example.com" }],
					embeds: [],
				}),
			} as any,
		});
		const issues = await externalLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("deduplicates same URL across multiple notes", async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as any);
		const file1 = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const file2 = { path: "b.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [file1, file2],
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "https://same-url.example.com" }],
					embeds: [],
				}),
			} as any,
		});
		const issues = await externalLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
	});
});
