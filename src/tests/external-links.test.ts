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
		requestUrl: async (url, method) => {
			const response = await requestUrl({ url, method });
			return { status: response.status, method };
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

function makeFileCtx(
	requestUrl: ScanContext["requestUrl"],
): ScanContext {
	const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
	return makeCtx({
		requestUrl,
		markdownFiles: [file],
		metadataCache: {
			getFileCache: () => ({
				links: [{ link: "https://example.com/target" }],
				embeds: [],
			}),
		} as any,
	});
}

describe("externalLinksScanner", () => {
	it("reports dead external links (HTTP 404)", async () => {
		vi.mocked(requestUrl).mockResolvedValue({ status: 404 } as any);
		// Routed through the mocked Obsidian requestUrl, like the plugin adapter.
		const ctx = makeFileCtx(async (url, method) => {
			const response = await requestUrl({ url, method });
			return { status: response.status, method };
		});

		const issues = await externalLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			severity: "warning",
			title: "Dead external link",
			classification: "candidate",
			message: "HTTP 404 — https://example.com/target",
			evidence: {
				url: "https://example.com/target",
				status: 404,
				method: "HEAD",
			},
		});
		expect(issues[0].explanation).toEqual({
			why: "The server returned HTTP 404 for this URL.",
			nextStep: "Open the URL manually, then update or remove it if the failure persists.",
			caveat: "HTTP 404 and 410 strongly indicate the resource is gone; access restrictions, rate limits, and server failures are reported separately.",
		});
	});

	it("reports HTTP 410 as a dead-link candidate with the shared dead-link fingerprint", async () => {
		const ctx = makeFileCtx(async () => ({ status: 410, method: "HEAD" }));

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("Dead external link");
		expect(issues[0].classification).toBe("candidate");
		expect(issues[0].severity).toBe("warning");
		expect(issues[0].evidence).toMatchObject({ status: 410, method: "HEAD" });
	});

	it("keeps other 4xx statuses as dead-link candidates", async () => {
		const ctx = makeFileCtx(async () => ({ status: 400, method: "HEAD" }));

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("Dead external link");
		expect(issues[0].classification).toBe("candidate");
	});

	it("presents HTTP 401 as access-restricted, not dead", async () => {
		const ctx = makeFileCtx(async () => ({ status: 401, method: "HEAD" }));

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			severity: "info",
			title: "External link access restricted",
			classification: "unverified",
			message: "HTTP 401 — https://example.com/target",
			evidence: {
				url: "https://example.com/target",
				status: 401,
				method: "HEAD",
				restricted: true,
			},
		});
		expect(issues[0].explanation).toEqual({
			why: "The server returned HTTP 401, so this URL's availability could not be verified.",
			nextStep: "Open the URL in a browser — a login, paywall, or bot protection may be required.",
			caveat: "Access-restricted responses do not mean the link is dead.",
		});
	});

	it("presents HTTP 403 as access-restricted, not dead", async () => {
		const ctx = makeFileCtx(async () => ({ status: 403, method: "HEAD" }));

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("External link access restricted");
		expect(issues[0].classification).toBe("unverified");
		expect(issues[0].severity).toBe("info");
		expect(issues[0].evidence).toMatchObject({ status: 403, restricted: true });
	});

	it("presents HTTP 429 as rate-limited, not dead", async () => {
		const ctx = makeFileCtx(async () => ({ status: 429, method: "HEAD" }));

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			severity: "info",
			title: "External link rate limited",
			classification: "unverified",
			message: "HTTP 429 — https://example.com/target",
			evidence: {
				url: "https://example.com/target",
				status: 429,
				method: "HEAD",
				rateLimited: true,
			},
		});
		expect(issues[0].explanation).toEqual({
			why: "The server rate-limited the check (HTTP 429), so this URL's availability could not be verified.",
			nextStep: "Run the scan again later.",
			caveat: "Rate-limited responses do not mean the link is dead.",
		});
	});

	it("presents 5xx as a candidate temporary server failure", async () => {
		const ctx = makeFileCtx(async () => ({ status: 503, method: "HEAD" }));

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			severity: "info",
			title: "External link server error",
			classification: "candidate",
			message: "HTTP 503 — https://example.com/target",
			evidence: {
				url: "https://example.com/target",
				status: 503,
				method: "HEAD",
				serverError: true,
			},
		});
		expect(issues[0].explanation).toEqual({
			why: "The server reported a failure (HTTP 503).",
			nextStep: "Run the scan again later; if the failure persists, verify the URL manually.",
			caveat: "Server-side failures are often temporary and do not yet indicate a dead link.",
		});
	});

	it("does not report healthy links (HTTP 200)", async () => {
		const ctx = makeFileCtx(async () => ({ status: 200, method: "HEAD" }));

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(0);
	});

	it("falls back to a Range GET when HEAD is rejected with 405", async () => {
		const calls: Array<[string, "HEAD" | "GET"]> = [];
		const ctx = makeFileCtx(async (url, method) => {
			calls.push([url, method]);
			return { status: method === "HEAD" ? 405 : 200, method };
		});

		const issues = await externalLinksScanner.scan(ctx);

		expect(calls).toEqual([
			["https://example.com/target", "HEAD"],
			["https://example.com/target", "GET"],
		]);
		expect(issues).toHaveLength(0);
	});

	it("falls back to a Range GET when HEAD is rejected with 501 and reports the GET status", async () => {
		const ctx = makeFileCtx(async (_url, method) => ({
			status: method === "HEAD" ? 501 : 404,
			method,
		}));

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("Dead external link");
		expect(issues[0].evidence).toMatchObject({ status: 404, method: "GET" });
	});

	it("does not fall back for statuses other than 405 or 501", async () => {
		const calls: Array<[string, "HEAD" | "GET"]> = [];
		const ctx = makeFileCtx(async (url, method) => {
			calls.push([url, method]);
			return { status: 404, method };
		});

		await externalLinksScanner.scan(ctx);

		expect(calls).toEqual([["https://example.com/target", "HEAD"]]);
	});

	it("reports a failed fallback as a request failure", async () => {
		const ctx = makeFileCtx(async (_url, method) => {
			if (method === "GET") throw new Error("fallback transport failed");
			return { status: 405, method };
		});

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].title).toBe("External link check failed");
		expect(issues[0].classification).toBe("unverified");
		expect(issues[0].evidence).toMatchObject({
			url: "https://example.com/target",
			error: "fallback transport failed",
		});
	});

	it("produces stable and distinct fingerprints per classification", async () => {
		const run = (status: number) =>
			externalLinksScanner.scan(
				makeFileCtx(async () => ({ status, method: "HEAD" })),
			);

		const [deadFirst, deadSecond, restricted, rateLimited, serverError] =
			await Promise.all([
				run(404),
				run(404),
				run(403),
				run(429),
				run(500),
			]);

		expect(deadFirst[0].fingerprint).toBe(deadSecond[0].fingerprint);
		expect(restricted[0].fingerprint).not.toBe(deadFirst[0].fingerprint);
		expect(rateLimited[0].fingerprint).not.toBe(deadFirst[0].fingerprint);
		expect(rateLimited[0].fingerprint).not.toBe(restricted[0].fingerprint);
		expect(serverError[0].fingerprint).not.toBe(deadFirst[0].fingerprint);
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
			requestUrl: async (url, method) => {
				checkedUrls.push(url);
				void method;
				return { status: 200, method };
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
			requestUrl: async (url, method) => {
				checkedUrls.push(url);
				void method;
				return { status: 404, method };
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
			requestUrl: () => new Promise(() => {}),
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
		} finally {
			vi.useRealTimers();
		}
	});

	it("reports failed external link checks separately from dead links", async () => {
		const ctx = makeFileCtx(async () => {
			throw new Error("network unavailable");
		});

		const issues = await externalLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toEqual(expect.objectContaining({
			scannerId: "external-links",
			severity: "info",
			title: "External link check failed",
			primaryPath: "a.md",
			evidence: expect.objectContaining({
				url: "https://example.com/target",
				error: "network unavailable",
			}),
		}));
		expect(issues[0].classification).toBe("unverified");
	});

	it("stops external link checks after the scan budget", async () => {
		vi.useFakeTimers();
		const file = { path: "a.md", stat: { size: 100, mtime: 1000 } } as any;
		const links = Array.from({ length: 65 }, (_, index) => ({
			link: `https://example.com/slow-${index}`,
		}));
		const ctx = makeCtx({
			requestUrl: () => new Promise(() => {}),
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
			requestUrl: async (url, method) => {
				const response = await requestUrl({ url, method });
				return { status: response.status, method };
			},
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
