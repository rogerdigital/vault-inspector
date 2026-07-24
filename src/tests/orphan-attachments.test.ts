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

	it("does not report attachments referenced by a frontmatter property", async () => {
		const md = { path: "notes/a.md" } as any;
		const attachment = makeFile("attachments/backup.pdf", 1000);
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md, attachment],
			filePathIndex: new Set(["notes/a.md", "attachments/backup.pdf"]),
			metadataCache: {
				getFileCache: () => ({
					links: [],
					embeds: [],
					frontmatterLinks: [
						{
							key: "sourceBackup",
							link: "backup.pdf",
							original: "[[backup.pdf]]",
						},
					],
				}),
			} as any,
		});

		const issues = await orphanAttachmentsScanner.scan(ctx);

		expect(issues).toHaveLength(0);
	});

	it("does not report attachments referenced by a frontmatter array", async () => {
		const md = { path: "notes/a.md" } as any;
		const first = makeFile("attachments/first.pdf", 1000);
		const second = makeFile("attachments/second.pdf", 1000);
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md, first, second],
			filePathIndex: new Set([
				"notes/a.md",
				"attachments/first.pdf",
				"attachments/second.pdf",
			]),
			metadataCache: {
				getFileCache: () => ({
					links: [],
					embeds: [],
					frontmatterLinks: [
						{
							key: "references",
							link: "first.pdf",
							original: "[[first.pdf]]",
						},
						{
							key: "references",
							link: "second.pdf",
							original: "[[second.pdf]]",
						},
					],
				}),
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

	it("only marks the Obsidian-resolved same-name attachment as referenced", async () => {
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
				getFirstLinkpathDest: (linkPath: string, sourcePath: string) => {
					expect(linkPath).toBe("image.png");
					expect(sourcePath).toBe("notes/a.md");
					return first;
				},
				resolvedLinks: {
					"notes/a.md": {
						"attachments/image.png": 1,
					},
				},
			} as any,
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].primaryPath).toBe("archive/image.png");
	});

	it("does not treat a resolvedLinks occurrence count as a destination path", async () => {
		const md = { path: "notes/a.md" } as any;
		const attachment = makeFile("assets/used.png", 1000);
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md, attachment],
			filePathIndex: new Set(["notes/a.md", "assets/used.png"]),
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "assets/used.png" }],
					embeds: [],
				}),
				resolvedLinks: {
					"notes/a.md": {
						"assets/used.png": 1,
					},
				},
			} as any,
		});

		const issues = await orphanAttachmentsScanner.scan(ctx);

		expect(issues).toHaveLength(0);
	});

	it("prefers the source folder for same-name attachments without resolved metadata", async () => {
		const md = { path: "zeta/note.md" } as any;
		const local = makeFile("zeta/image.png", 1000);
		const other = makeFile("alpha/image.png", 1000);
		const ctx = makeCtx({
			markdownFiles: [md],
			allFiles: [md, local, other],
			filePathIndex: new Set([
				"zeta/note.md",
				"zeta/image.png",
				"alpha/image.png",
			]),
			metadataCache: {
				getFileCache: () => ({
					links: [],
					embeds: [{ link: "image.png" }],
				}),
			} as any,
		});

		const issues = await orphanAttachmentsScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].primaryPath).toBe("alpha/image.png");
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
