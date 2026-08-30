import { describe, it, expect } from "vitest";
import { brokenLinksScanner } from "../scanner/scanners/broken-links";
import type { ScanContext } from "../scanner/ScanContext";
import { makeScanContext } from "./helpers/scan-context";

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["broken-links"]),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		watchedTags: [],
		ignoredFolders: [],
		ignoreUnresolvedNoteLinks: false,
		...overrides,
	} as ScanContext;
}

describe("brokenLinksScanner", () => {
	it("detects unresolved link to missing file", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "notes/missing": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("error");
		expect(issues[0].evidence.target).toBe("notes/missing");
		expect(issues[0]).toMatchObject({
			classification: "confirmed",
			explanation: {
				why: "The link target could not be resolved in the vault.",
				nextStep: "Correct the target or remove the link from the source note.",
			},
		});
	});

	it("does not report links that resolve to existing files", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "notes/b": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("detects broken heading link", async () => {
		const file = { path: "notes/a.md" } as any;
		const targetFile = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file, targetFile],
			allFiles: [file, targetFile],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			metadataCache: {
				getFileCache: (f: any) => {
					if (f.path === "notes/b.md") {
						return { headings: [{ heading: "Other Heading" }] };
					}
					return {};
				},
				unresolvedLinks: {
					"notes/a.md": { "notes/b#Missing Heading": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("warning");
		expect(issues[0].message).toContain("Heading");
		expect(issues[0]).toMatchObject({
			classification: "confirmed",
			explanation: {
				why: "The target note exists, but the referenced heading was not found.",
				nextStep: "Correct the heading reference or remove it from the source note.",
			},
		});
	});

	it("does not report valid heading links", async () => {
		const file = { path: "notes/a.md" } as any;
		const targetFile = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file, targetFile],
			allFiles: [file, targetFile],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			metadataCache: {
				getFileCache: (f: any) => {
					if (f.path === "notes/b.md") {
						return { headings: [{ heading: "My Heading" }] };
					}
					return {};
				},
				unresolvedLinks: {
					"notes/a.md": { "notes/b#My Heading": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("detects missing non-English headings without collapsing them", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [
				{ path: "notes/source.md" },
				{ path: "notes/目标.md" },
			],
			metadataByPath: {
				"notes/source.md": {},
				"notes/目标.md": {
					headings: [{ heading: "项目计划", level: 2, position: {} as any }],
				},
			},
			unresolvedLinks: {
				"notes/source.md": {
					"目标#不存在": 1,
				},
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toEqual(expect.objectContaining({
			severity: "warning",
			primaryPath: "notes/source.md",
			relatedPaths: ["notes/目标.md"],
			evidence: expect.objectContaining({
				link: "目标#不存在",
				target: "notes/目标.md",
			}),
		}));
	});

	it("handles aliased links", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "notes/missing|alias text": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.target).toBe("notes/missing");
	});

	it("does not offer a wiki removal action for Markdown links", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [
				{ path: "Source.md" },
				{ path: "Target.md" },
			],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Target#Missing",
						original: "[Target](Target.md#Missing)",
						position: {} as any,
					}],
				},
				"Target.md": {
					headings: [{
						heading: "Existing",
						level: 1,
						position: {} as any,
					}],
				},
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("warning");
		expect(issues[0].fixAction).toBeUndefined();
	});

	it("keeps an exact removal action for aliased wiki links", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Missing",
						original: "[[Missing|Alias]]",
						displayText: "Alias",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": {
					Missing: 1,
				},
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			kind: "remove-link-text",
			linkText: "Missing|Alias",
		}));
	});

	it("merges plain and aliased references to the same missing target into one finding", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [
						{
							link: "Missing Note",
							original: "[[Missing Note]]",
							position: {} as any,
						},
						{
							link: "Missing Note",
							original: "[[Missing Note|Readable Label]]",
							displayText: "Readable Label",
							position: {} as any,
						},
					],
				},
			},
			unresolvedLinks: {
				"Source.md": { "Missing Note": 2 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.link).toBe("Missing Note");
		expect(issues[0].message).toBe("Linked file not found: Missing Note");
		// Document order makes the first (plain) reference's fix text win.
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			kind: "remove-link-text",
			linkText: "Missing Note",
		}));
	});

	it("detects missing attachment links", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "assets/image.png": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("error");
		expect(issues[0].message).toContain("Attachment");
	});

	it("does not report short wiki attachment links that match files in attachment folders", async () => {
		const file = { path: "notes/a.md" } as any;
		const image = { path: "attachments/image.png" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file, image],
			filePathIndex: new Set(["notes/a.md", "attachments/image.png"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "image.png": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not report short wiki note links that match files outside the current folder", async () => {
		const file = { path: "notes/a.md" } as any;
		const targetFile = { path: "articles/Linked Note.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file, targetFile],
			allFiles: [file, targetFile],
			filePathIndex: new Set(["notes/a.md", "articles/Linked Note.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "Linked Note": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files in ignored folders", async () => {
		const file = { path: "templates/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["templates/a.md"]),
			ignoredFolders: ["templates"],
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"templates/a.md": { missing: 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files with no cache", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => null,
				unresolvedLinks: {},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files with no unresolved links", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("resolves links with .md extension appended", async () => {
		const file = { path: "notes/a.md" } as any;
		const targetFile = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file, targetFile],
			allFiles: [file, targetFile],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "notes/b": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("produces stable fingerprints for the same issue", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { missing: 1 },
				},
			} as any,
		});
		const issues1 = await brokenLinksScanner.scan(ctx);
		const issues2 = await brokenLinksScanner.scan(ctx);
		expect(issues1[0].fingerprint).toBe(issues2[0].fingerprint);
	});

	it("ignores unresolved plain note wikilinks when enabled", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Future Note|Someday",
						original: "[[Future Note|Someday]]",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { "Future Note|Someday": 1 },
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toEqual([]);
	});

	it("keeps non-plain-link failures when unresolved note links are ignored", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [
				{ path: "Source.md" },
				{ path: "Target.md" },
			],
			metadataByPath: {
				"Source.md": {
					links: [
						{
							link: "missing.md",
							original: "[Missing](missing.md)",
							position: {} as any,
						},
						{
							link: "Target#Missing",
							original: "[[Target#Missing]]",
							position: {} as any,
						},
					],
					embeds: [
						{
							link: "Missing Note",
							original: "![[Missing Note]]",
							position: {} as any,
						},
						{
							link: "assets/missing.png",
							original: "![[assets/missing.png]]",
							position: {} as any,
						},
					],
				},
				"Target.md": {
					headings: [{
						heading: "Existing",
						level: 1,
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": {
					"missing.md": 1,
					"Missing Note": 1,
					"assets/missing.png": 1,
				},
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(4);
		expect(issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
			"Linked file not found: missing.md",
			'Heading "#Missing" not found in Target.md',
			"Linked file not found: Missing Note",
			"Attachment not found: assets/missing.png",
		]));
	});

	it("keeps unresolved targets whose original reference syntax is unavailable", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			unresolvedLinks: {
				"Source.md": { Unknown: 1 },
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toBe("Linked file not found: Unknown");
	});

	it("keeps a target referenced by both a plain wikilink and an embed", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Missing",
						original: "[[Missing]]",
						position: {} as any,
					}],
					embeds: [{
						link: "Missing",
						original: "![[Missing]]",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { Missing: 2 },
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toBe("Linked file not found: Missing");
	});

	it("keeps non-embed wikilinks to missing attachments when unresolved note links are ignored", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "missing.png",
						original: "[[missing.png]]",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { "missing.png": 1 },
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toBe("Attachment not found: missing.png");
		expect(issues[0].severity).toBe("error");
	});
});
