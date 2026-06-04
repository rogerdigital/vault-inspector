import { describe, it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { orphanAttachmentsScanner } from "../scanner/scanners/orphan-attachments";
import type { ScanContext } from "../scanner/ScanContext";

function makeFile(path: string, mtime: number) {
	return { path, stat: { size: 1024, mtime } } as any;
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
		...overrides,
	} as ScanContext;
}

describe("orphanAttachmentsScanner", () => {
	it("detects attachments not referenced by any note", async () => {
		const md = { path: "notes/a.md" } as any;
		const img = makeFile("assets/orphan.png", 1000);
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md, img],
			filePathIndex: new Set(["notes/a.md", "assets/orphan.png"]),
			metadataCache: {
				getFileCache: () => ({ links: [], embeds: [] }),
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].primaryPath).toBe("assets/orphan.png");
	});

	it("does not report attachments referenced by notes", async () => {
		const md = { path: "notes/a.md" } as any;
		const img = makeFile("assets/used.png", 1000);
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md, img],
			filePathIndex: new Set(["notes/a.md", "assets/used.png"]),
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "assets/used.png" }],
					embeds: [],
				}),
				resolvedLinks: {
					"notes/a.md": { "assets/used.png": "assets/used.png" },
				},
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not report attachments referenced by short wiki embed names", async () => {
		const md = { path: "notes/a.md" } as any;
		const img = makeFile("attachments/image.png", 1000);
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md, img],
			filePathIndex: new Set(["notes/a.md", "attachments/image.png"]),
			metadataCache: {
				getFileCache: () => ({
					links: [],
					embeds: [{ link: "image.png" }],
				}),
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not report ambiguous same-name attachments as orphan when short wiki embeds reference them", async () => {
		const md = { path: "notes/a.md" } as any;
		const first = makeFile("attachments/image.png", 1000);
		const second = makeFile("archive/image.png", 1000);
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md, first, second],
			filePathIndex: new Set([
				"notes/a.md",
				"attachments/image.png",
				"archive/image.png",
			]),
			metadataCache: {
				getFileCache: () => ({
					links: [],
					embeds: [{ link: "image.png" }],
				}),
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("downgrades recently modified orphans to info", async () => {
		const img = makeFile("assets/recent.png", Date.now() - 1000);
		const ctx = makeCtx({
			markdownFiles: [],
			allFiles: [img],
			filePathIndex: new Set(["assets/recent.png"]),
			metadataCache: {
				getFileCache: () => null,
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("info");
	});

	it("uses warning severity for old orphans", async () => {
		const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
		const img = makeFile("assets/old.png", oldTime);
		const ctx = makeCtx({
			markdownFiles: [],
			allFiles: [img],
			filePathIndex: new Set(["assets/old.png"]),
			metadataCache: {
				getFileCache: () => null,
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("warning");
	});

	it("skips non-attachment files", async () => {
		const md = { path: "notes/a.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			markdownFiles: [],
			allFiles: [md],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => null,
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files in ignored folders", async () => {
		const img = makeFile("templates/bg.png", 1000);
		const ctx = makeCtx({
			markdownFiles: [],
			allFiles: [img],
			filePathIndex: new Set(["templates/bg.png"]),
			ignoredFolders: ["templates"],
			metadataCache: {
				getFileCache: () => null,
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("resolves many short attachment embeds without scanning all files per link", async () => {
		const md = { path: "notes/a.md" } as any;
		const attachments = Array.from({ length: 2000 }, (_, index) =>
			makeFile(`attachments/image-${index}.png`, 1000),
		);
		const embeds = attachments.map((file) => ({
			link: file.path.split("/").pop()!,
		}));
		const allFiles = [md, ...attachments];
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles,
			filePathIndex: new Set(allFiles.map((file) => file.path)),
			metadataCache: {
				getFileCache: () => ({
					links: [],
					embeds,
				}),
			} as any,
		});

		const startedAt = performance.now();
		const issues = await orphanAttachmentsScanner.scan(ctx);
		const durationMs = performance.now() - startedAt;

		expect(issues).toHaveLength(0);
		expect(durationMs).toBeLessThan(500);
	});
});
