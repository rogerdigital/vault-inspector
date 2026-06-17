import { describe, it, expect, vi } from "vitest";
import { requestUrl } from "obsidian";
import {
	EXTERNAL_LINK_SCAN_BUDGET_MS,
	EXTERNAL_LINK_TIMEOUT_MS,
	externalLinksScanner,
} from "../scanner/scanners/external-links";
import type { ScanContext } from "../scanner/ScanContext";

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		requestUrl: async (url) => {
			const response = await requestUrl({ url, method: "HEAD" });
			return response.status;
		},
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (timeoutId) => clearTimeout(timeoutId as ReturnType<typeof setTimeout>),
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

	it("checks bare URLs in Markdown body text", async () => {
		const checkedUrls: string[] = [];
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			requestUrl: async (url) => {
				checkedUrls.push(url);
				return 404;
			},
			markdownFiles: [file],
			vault: {
				cachedRead: async () => [
					"https://example.com/bare.",
					"https://example.com/paren)",
					"```",
					"https://example.com/code",
					"```",
				].join("\n"),
			} as any,
			metadataCache: {
				getFileCache: () => ({
					links: [],
					embeds: [],
				}),
			} as any,
		});

		const issues = await externalLinksScanner.scan(ctx);

		expect(checkedUrls).toEqual([
			"https://example.com/bare",
			"https://example.com/paren",
		]);
		expect(issues).toHaveLength(2);
		expect(issues.map((issue) => issue.evidence.url)).toEqual(checkedUrls);
	});

	it("reports timed out external links without hanging the scan", async () => {
		vi.useFakeTimers();
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			requestUrl: () => new Promise<number>(() => {}),
			markdownFiles: [file],
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "https://example.com/slow" }],
					embeds: [],
				}),
			} as any,
		});

		try {
			const scan = externalLinksScanner.scan(ctx);
			await vi.advanceTimersByTimeAsync(EXTERNAL_LINK_TIMEOUT_MS);
			const issues = await scan;

			expect(issues).toHaveLength(1);
			expect(issues[0]).toEqual(expect.objectContaining({
				scannerId: "external-links",
				severity: "info",
				title: "External link check timed out",
				primaryPath: "a.md",
				evidence: expect.objectContaining({
					url: "https://example.com/slow",
					timeoutMs: EXTERNAL_LINK_TIMEOUT_MS,
				}),
			}));
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports failed external link checks separately from dead links", async () => {
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const ctx = makeCtx({
			requestUrl: async () => {
				throw new Error("network unavailable");
			},
			markdownFiles: [file],
			metadataCache: {
				getFileCache: () => ({
					links: [{ link: "https://example.com/error" }],
					embeds: [],
				}),
			} as any,
		});

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toEqual(expect.objectContaining({
			scannerId: "external-links",
			severity: "info",
			title: "External link check failed",
			primaryPath: "a.md",
			evidence: expect.objectContaining({
				url: "https://example.com/error",
				error: "network unavailable",
			}),
		}));
	});

	it("stops external link checks after the scan budget", async () => {
		vi.useFakeTimers();
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const links = Array.from({ length: 65 }, (_, index) => ({
			link: `https://example.com/slow-${index}`,
		}));
		const ctx = makeCtx({
			requestUrl: () => new Promise<number>(() => {}),
			markdownFiles: [file],
			metadataCache: {
				getFileCache: () => ({
					links,
					embeds: [],
				}),
			} as any,
		});

		try {
			const scan = externalLinksScanner.scan(ctx);
			for (let elapsed = 0; elapsed < EXTERNAL_LINK_SCAN_BUDGET_MS; elapsed += EXTERNAL_LINK_TIMEOUT_MS) {
				await vi.advanceTimersByTimeAsync(EXTERNAL_LINK_TIMEOUT_MS);
			}
			const issues = await scan;
			const skipped = issues.find((issue) => issue.title === "External link checks skipped");

			expect(skipped).toEqual(expect.objectContaining({
				scannerId: "external-links",
				severity: "info",
				evidence: expect.objectContaining({
					skipped: 5,
					budgetMs: EXTERNAL_LINK_SCAN_BUDGET_MS,
				}),
			}));
		} finally {
			vi.useRealTimers();
		}
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
