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
		const httpIssue = issues[0];
		expect(httpIssue.evidence.status).toBe(404);
		expect(httpIssue).toMatchObject({
			classification: "candidate",
			explanation: {
				why: "The server returned HTTP 404 for this URL.",
				caveat: "Authentication, rate limits, bot protection, and temporary outages can produce a non-success status.",
				nextStep: "Open the URL manually, then update or remove it if the failure persists.",
			},
		});
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

	it("blocks unsafe destinations before invoking the request adapter", async () => {
		const checkedUrls: string[] = [];
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const blockedUrls = [
			"http://127.0.0.1/admin",
			"http://2130706433/alternate-loopback",
			"http://10.0.0.1/private",
			"http://169.254.169.254/latest/meta-data/",
			"http://localhost/service",
			"http://[fd00::1]/private",
			"http://user:pass@example.com/",
			"http://",
		];
		const publicUrl = "https://example.com/good";
		const ctx = makeCtx({
			requestUrl: async (url) => {
				checkedUrls.push(url);
				return 200;
			},
			markdownFiles: [file],
			metadataCache: {
				getFileCache: () => ({
					links: [...blockedUrls, publicUrl].map((link) => ({ link })),
					embeds: [],
				}),
			} as any,
		});

		const issues = await externalLinksScanner.scan(ctx);

		expect(checkedUrls).toEqual([publicUrl]);
		expect(issues).toHaveLength(blockedUrls.length);
		expect(issues.map((issue) => issue.evidence.url)).toEqual(blockedUrls);
		expect(issues).toEqual(blockedUrls.map((url) => expect.objectContaining({
			scannerId: "external-links",
			severity: "info",
			title: "External link check blocked",
			primaryPath: "a.md",
			evidence: expect.objectContaining({ url }),
		})));
		for (const blockedIssue of issues) {
			expect(blockedIssue.classification).toBe("unverified");
			expect(blockedIssue.explanation).toEqual({
				why: `The external-link safety policy blocked this destination (${blockedIssue.evidence.reason}).`,
				nextStep: "Review or correct the URL based on the reported reason, then run the scanner again.",
				caveat: "Availability was not tested because this URL was rejected before reaching the request adapter.",
			});
		}
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
			expect(issues[0].classification).toBe("unverified");
			expect(issues[0].explanation).toEqual({
				why: `The URL did not respond within ${EXTERNAL_LINK_TIMEOUT_MS}ms.`,
				nextStep: "Retry the scan or open the URL manually.",
				caveat: "Slow networks and temporary server load can cause timeouts.",
			});
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
		expect(issues[0].classification).toBe("unverified");
		expect(issues[0].explanation).toEqual({
			why: "The URL check failed before an HTTP status was received.",
			nextStep: "Retry the scan or open the URL manually and inspect the reported error.",
			caveat: "DNS, TLS, connectivity, and remote-server failures can be temporary.",
		});
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
			expect(skipped?.classification).toBe("unverified");
			expect(skipped?.explanation).toEqual({
				why: `The scanner reached its ${EXTERNAL_LINK_SCAN_BUDGET_MS / 1000}-second scan budget before checking 5 URL(s).`,
				nextStep: "Run the external-link scanner again or reduce the number of URLs checked at once.",
				caveat: "Unchecked URLs may still be healthy or broken.",
			});
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
