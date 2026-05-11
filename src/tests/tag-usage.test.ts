import { describe, it, expect } from "vitest";
import { tagUsageScanner } from "../scanner/scanners/tag-usage";
import type { ScanContext } from "../scanner/ScanContext";

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["tag-usage"]),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		watchedTags: [],
		ignoredFolders: [],
		ignoredProperties: [],
		...overrides,
	} as ScanContext;
}

describe("tagUsageScanner", () => {
	it("reports low-usage tags below threshold", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			lowUsageTagThreshold: 2,
			metadataCache: {
				getFileCache: () => ({
					tags: [{ tag: "#rare" }],
					frontmatter: {},
				}),
			} as any,
		});
		const issues = await tagUsageScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("Low-usage tag");
		expect(issues[0].evidence.tag).toBe("rare");
	});

	it("does not report tags at or above threshold", async () => {
		const fileA = { path: "notes/a.md" } as any;
		const fileB = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [fileA, fileB],
			allFiles: [fileA, fileB],
			lowUsageTagThreshold: 2,
			metadataCache: {
				getFileCache: () => ({
					tags: [{ tag: "#common" }],
					frontmatter: {},
				}),
			} as any,
		});
		const issues = await tagUsageScanner.scan(ctx);
		const lowUsage = issues.filter((i) => i.title === "Low-usage tag");
		expect(lowUsage).toHaveLength(0);
	});

	it("reports watched tags with their counts", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			watchedTags: ["important"],
			metadataCache: {
				getFileCache: () => ({
					tags: [{ tag: "#important" }],
					frontmatter: {},
				}),
			} as any,
		});
		const issues = await tagUsageScanner.scan(ctx);
		const watched = issues.filter((i) => i.title === "Watched tag");
		expect(watched).toHaveLength(1);
		expect(watched[0].evidence.tag).toBe("important");
		expect(watched[0].evidence.count).toBe(1);
	});

	it("reports watched tags even with zero uses", async () => {
		const ctx = makeCtx({
			markdownFiles: [],
			allFiles: [],
			watchedTags: ["missing-tag"],
			metadataCache: {
				getFileCache: () => null,
			} as any,
		});
		const issues = await tagUsageScanner.scan(ctx);
		const watched = issues.filter((i) => i.title === "Watched tag");
		expect(watched).toHaveLength(1);
		expect(watched[0].evidence.count).toBe(0);
	});

	it("reads tags from frontmatter tags field", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			lowUsageTagThreshold: 3,
			metadataCache: {
				getFileCache: () => ({
					tags: [],
					frontmatter: { tags: ["fm-tag"] },
				}),
			} as any,
		});
		const issues = await tagUsageScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.tag).toBe("fm-tag");
	});

	it("skips files in ignored folders", async () => {
		const file = { path: "templates/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			ignoredFolders: ["templates"],
			lowUsageTagThreshold: 2,
			metadataCache: {
				getFileCache: () => ({
					tags: [{ tag: "#rare" }],
					frontmatter: {},
				}),
			} as any,
		});
		const issues = await tagUsageScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});
});
