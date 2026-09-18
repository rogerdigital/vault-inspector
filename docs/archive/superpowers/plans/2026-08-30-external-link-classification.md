# External Link Classification Implementation Plan (Milestone 1, Task 1.6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the roadmap status policy exactly: 404/410 (and other unlisted 4xx) stay `Dead external link` warning candidates; 401/403 become `External link access restricted` (info, unverified); 429 becomes `External link rate limited` (info, unverified); 5xx becomes `External link server error` (info, candidate); timeout/failure stay unverified; safety-policy blocks stay unverified-and-blocked. The status-only request adapter `(url, signal) => Promise<number>` is replaced by a method-aware contract `(url, method, signal) => Promise<{ status, method }>`; the scanner issues HEAD first and one bounded Range GET fallback (`Range: bytes=0-0`, body discarded) only for 405/501; URL/DNS/redirect/public-IP checks re-run for every fallback and redirect destination. Timeouts (5s), scan budget (60s), and 5-request batching are unchanged; external-link scanning stays disabled by default. `COMPARISON_VERSION` bumps 1 → 2 because 403/429/5xx findings change identity (old snapshots would otherwise mislabel them as resolved).

**Architecture:** Contract types live in `src/scanner/ScanContext.ts` and flow unchanged through `ScanRunner` into `ScanContext.requestUrl`. The scanner (`src/scanner/scanners/external-links.ts`) owns the fallback decision and the per-status issue shapes. The CLI adapter (`cli/public-http.ts`) gains the method parameter, revalidates URL + DNS before every connection (redirect hops and the fallback GET), and pins requests to the validated address. The Obsidian adapter (`src/main.ts`) passes the method and Range header through to Obsidian's `requestUrl`. No settings, report, fix, or snapshot-format changes — only `COMPARISON_VERSION` semantics.

**Tech Stack:** TypeScript, Vitest, `makeScanContext` fixtures, Node `http`/`https` test doubles

Design doc: `docs/superpowers/specs/2026-08-30-external-link-classification-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.6)

---

## Ground rules

- Branch: `fix/external-link-classification`, cut from latest `main`.
- One commit: `fix: classify external link failures accurately`.
- The adapter result contract never carries a response body, headers, or redirect chain — only `{ status, method }`.
- The Range GET fallback fires only for HEAD statuses 405 and 501, once, with `Range: bytes=0-0`. Never add a fallback for other statuses.
- The dead-link fingerprint input stays exactly `{ url }`. The three new presentations use `{ url, restricted: true }`, `{ url, rateLimited: true }`, `{ url, serverError: true }`. Blocked/timeout/failed variants are unchanged.
- `COMPARISON_VERSION` becomes `2` (detection semantics change); `SNAPSHOT_SCHEMA_VERSION` stays `1`.
- `EXTERNAL_LINK_TIMEOUT_MS = 5000`, `EXTERNAL_LINK_SCAN_BUDGET_MS = 60000`, and the 5-request batch size are frozen — no performance evidence justifies changing them.
- External-link scanning stays disabled by default; no settings changes.
- Do not modify the precision fixture files (`src/tests/fixtures/precision-vault/**`); only assertions in `src/tests/scanner-precision.test.ts` change.
- Do not modify `src/scanner/finding-presentation.ts`, `src/scanner/issue-fingerprint.ts`, `src/report/*`, `src/fix/*`, `src/settings/*`, or `src/scanner/scanners/` other than `external-links.ts`.
- Never `eslint-disable` any `obsidianmd/*` rule.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b fix/external-link-classification
```

---

### Task 2: Rewrite the scanner unit tests first (TDD)

**Files:**
- Modify: `src/tests/external-links.test.ts` (full rewrite)

Every `>= 400` status now has a distinct presentation, the adapter is
method-aware, and the HEAD→GET fallback needs coverage. Replace the entire
file with:

```typescript
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
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/external-links.test.ts
```

Expected: FAIL — `ScanContext.requestUrl` still has the old two-argument
status-only type (compile errors on `method`), the new titles
(`External link access restricted`, `External link rate limited`,
`External link server error`) do not exist, and no fallback call is ever
issued.

---

### Task 3: Introduce the method-aware adapter contract

**Files:**
- Modify: `src/scanner/ScanContext.ts`
- Modify: `src/scanner/ScanRunner.ts`

- [ ] **Step 1: Add the contract types and replace the `requestUrl` field type in `src/scanner/ScanContext.ts`**

Replace (line 9):

```typescript
	requestUrl?: (url: string, signal?: AbortSignal) => Promise<number>;
```

with:

```typescript
	requestUrl?: ExternalRequestAdapter;
```

and insert above the `ScanContext` type declaration:

```typescript
export type ExternalHttpMethod = "HEAD" | "GET";

export type ExternalRequestResult = {
	status: number;
	method: ExternalHttpMethod;
};

/**
 * Method-aware external request contract. Implementations must:
 * 1. issue exactly the requested method against exactly the requested URL;
 * 2. throw on transport failure (the scanner maps that to a failed finding);
 * 3. return only the final status and method — never a response body;
 * 4. re-run URL/DNS/public-IP/redirect-target safety checks for every
 *    connection they open, including the Range GET fallback.
 */
export type ExternalRequestAdapter = (
	url: string,
	method: ExternalHttpMethod,
	signal?: AbortSignal,
) => Promise<ExternalRequestResult>;
```

- [ ] **Step 2: Update the `ScanRunner` constructor type in `src/scanner/ScanRunner.ts`**

Change the import (line 3):

```typescript
import type { ScanContext } from "./ScanContext";
```

to:

```typescript
import type { ExternalRequestAdapter, ScanContext } from "./ScanContext";
```

and replace the constructor parameter (line 27):

```typescript
		private requestUrl?: (url: string) => Promise<number>,
```

with:

```typescript
		private requestUrl?: ExternalRequestAdapter,
```

The value is already threaded into `ctx.requestUrl` unchanged — no other
`ScanRunner` edits.

---

### Task 4: Rewrite the scanner

**Files:**
- Modify: `src/scanner/scanners/external-links.ts` (full rewrite)

- [ ] **Step 1: Replace the entire scanner file with:**

```typescript
import type { Issue } from "../Issue";
import type { ScanProgressCallback } from "../Issue";
import type { ExternalHttpMethod, ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";
import { assessExternalHttpUrl } from "../../utils/network-destination";

export const externalLinksScanner = {
	id: "external-links" as const,

	async scan(ctx: ScanContext, onProgress?: ScanProgressCallback): Promise<Issue[]> {
		const issues: Issue[] = [];
		const urlMap = await collectExternalUrls(ctx);
		const { results, skipped } = await checkUrls(urlMap, ctx, onProgress);

		for (const result of results) {
			const issue = makeIssue(result);
			if (issue) issues.push(issue);
		}

		if (skipped > 0) {
			issues.push({
				...describeFinding(
					"unverified",
					`The scanner reached its ${EXTERNAL_LINK_SCAN_BUDGET_MS / 1000}-second scan budget before checking ${skipped} URL(s).`,
					"Run the external-link scanner again or reduce the number of URLs checked at once.",
					"Unchecked URLs may still be healthy or broken.",
				),
				scannerId: "external-links",
				severity: "info",
				title: "External link checks skipped",
				message: `Stopped after ${EXTERNAL_LINK_SCAN_BUDGET_MS / 1000}s scan budget; ${skipped} URL(s) were not checked.`,
				relatedPaths: [],
				evidence: {
					skipped,
					budgetMs: EXTERNAL_LINK_SCAN_BUDGET_MS,
				},
				fingerprint: generateFingerprint("external-links", undefined, {
					skipped,
					budgetMs: EXTERNAL_LINK_SCAN_BUDGET_MS,
				}),
			});
		}

		return issues;
	},
};

export const EXTERNAL_LINK_TIMEOUT_MS = 5000;
export const EXTERNAL_LINK_SCAN_BUDGET_MS = 60000;
const EXTERNAL_LINK_BATCH_SIZE = 5;
const HEAD_REJECTED_STATUSES = new Set([405, 501]);

type UrlEntry = { url: string; sourcePath: string };
type CheckResult =
	| (UrlEntry & { kind: "http"; status: number; method: ExternalHttpMethod })
	| (UrlEntry & { kind: "blocked"; reason: string })
	| (UrlEntry & { kind: "timeout"; timeoutMs: number })
	| (UrlEntry & { kind: "failed"; error: string });

async function collectExternalUrls(ctx: ScanContext): Promise<UrlEntry[]> {
	const entries: UrlEntry[] = [];
	const seen = new Set<string>();

	for (const file of ctx.markdownFiles) {
		if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

		const cache = ctx.metadataCache.getFileCache(file);
		if (!cache) continue;

		const links = cache.links ?? [];
		const embeds = cache.embeds ?? [];

		for (const link of [...links, ...embeds]) {
			const href = link.link;
			if (!isExternalUrl(href)) continue;
			if (seen.has(href)) continue;
			seen.add(href);
			entries.push({ url: href, sourcePath: file.path });
		}

		if (cache.frontmatter) {
			for (const value of Object.values(cache.frontmatter)) {
				if (typeof value === "string" && isExternalUrl(value)) {
					if (seen.has(value)) continue;
					seen.add(value);
					entries.push({ url: value, sourcePath: file.path });
				}
			}
		}

		try {
			const content = await ctx.vault.cachedRead(file);
			for (const url of extractBareUrls(content)) {
				if (seen.has(url)) continue;
				seen.add(url);
				entries.push({ url, sourcePath: file.path });
			}
		} catch {
			continue;
		}
	}

	return entries;
}

function isExternalUrl(text: string): boolean {
	return /^https?:\/\//i.test(text);
}

export function extractBareUrls(content: string): string[] {
	const urls: string[] = [];
	const seen = new Set<string>();
	const body = stripIgnoredMarkdownRegions(stripFrontmatter(content));
	const urlPattern = /https?:\/\/[^\s<>"']+/gi;

	for (const match of body.matchAll(urlPattern)) {
		const url = trimUrlBoundary(match[0]);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		urls.push(url);
	}

	return urls;
}

function stripFrontmatter(content: string): string {
	const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
	return match ? content.slice(match[0].length) : content;
}

function stripIgnoredMarkdownRegions(content: string): string {
	return content
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/^[ \t]*(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?^[ \t]*\1[^\r\n]*$/gm, "")
		.replace(/(`+)[^\r\n]*?\1/g, "");
}

function trimUrlBoundary(url: string): string {
	let trimmed = url;
	while (/[),.;:!?]$/.test(trimmed)) {
		trimmed = trimmed.slice(0, -1);
	}
	return trimmed;
}

async function checkUrls(
	urlMap: UrlEntry[],
	ctx?: ScanContext,
	onProgress?: ScanProgressCallback,
): Promise<{ results: CheckResult[]; skipped: number }> {
	const results: CheckResult[] = [];
	const startedAt = Date.now();
	const deadline = startedAt + EXTERNAL_LINK_SCAN_BUDGET_MS;
	const stats = { timedOut: 0, failed: 0, blocked: 0 };

	reportExternalProgress(onProgress, urlMap.length, results.length, stats);

	for (let i = 0; i < urlMap.length; i += EXTERNAL_LINK_BATCH_SIZE) {
		if (Date.now() >= deadline) {
			const skipped = urlMap.length - i;
			reportExternalProgress(onProgress, urlMap.length, results.length, stats, skipped);
			return { results, skipped };
		}

		const timeoutMs = Math.max(1, Math.min(EXTERNAL_LINK_TIMEOUT_MS, deadline - Date.now()));
		const batch = urlMap.slice(i, i + EXTERNAL_LINK_BATCH_SIZE);
		const checks = batch.map((entry) => checkUrlWithTimeout(entry, ctx, timeoutMs));
		const batchResults = await Promise.all(checks);
		for (const result of batchResults) {
			if (result.kind === "blocked") stats.blocked++;
			if (result.kind === "timeout") stats.timedOut++;
			if (result.kind === "failed") stats.failed++;
		}
		results.push(...batchResults);
		reportExternalProgress(onProgress, urlMap.length, results.length, stats);
	}

	return { results, skipped: 0 };
}

function reportExternalProgress(
	onProgress: ScanProgressCallback | undefined,
	total: number,
	current: number,
	stats: { timedOut: number; failed: number; blocked: number },
	skipped = 0,
) {
	onProgress?.({
		type: "scanner-progress",
		scannerId: "external-links",
		scannerIndex: 0,
		scannerTotal: 0,
		phase: "Checking URLs",
		current,
		total,
		message: `blocked ${stats.blocked}, timed out ${stats.timedOut}, failed ${stats.failed}, skipped ${skipped}`,
		elapsedMs: 0,
	});
}

async function checkUrlWithTimeout(
	entry: UrlEntry,
	ctx: ScanContext | undefined,
	timeoutMs: number,
): Promise<CheckResult> {
	const controller = new AbortController();
	const result = await withTimeout(
		checkUrl(entry.url, ctx, controller.signal),
		timeoutMs,
		{
			...entry,
			kind: "timeout",
			timeoutMs,
		},
		ctx,
		() => controller.abort(),
	);
	return withSourcePath(result, entry.sourcePath);
}

async function checkUrl(
	url: string,
	ctx?: ScanContext,
	signal?: AbortSignal,
): Promise<CheckResult> {
	const assessment = assessExternalHttpUrl(url);
	if (!assessment.allowed) {
		return {
			url,
			sourcePath: "",
			kind: "blocked",
			reason: assessment.reason,
		};
	}

	if (!ctx?.requestUrl) {
		return {
			url,
			sourcePath: "",
			kind: "failed",
			error: "No request adapter configured",
		};
	}

	let head;
	try {
		head = await ctx.requestUrl(url, "HEAD", signal);
	} catch (error) {
		return { url, sourcePath: "", kind: "failed", error: errorMessage(error) };
	}

	// Bounded Range GET fallback: only when the origin rejected HEAD itself
	// (405/501). The fallback re-runs the URL safety policy here, and the
	// adapter contract additionally re-runs DNS, public-IP, and
	// redirect-target checks for every connection it opens.
	if (!HEAD_REJECTED_STATUSES.has(head.status)) {
		return { url, sourcePath: "", kind: "http", status: head.status, method: "HEAD" };
	}

	const fallbackAssessment = assessExternalHttpUrl(url);
	if (!fallbackAssessment.allowed) {
		return {
			url,
			sourcePath: "",
			kind: "blocked",
			reason: fallbackAssessment.reason,
		};
	}

	try {
		const rangeGet = await ctx.requestUrl(url, "GET", signal);
		return { url, sourcePath: "", kind: "http", status: rangeGet.status, method: "GET" };
	} catch (error) {
		return { url, sourcePath: "", kind: "failed", error: errorMessage(error) };
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	timeoutValue: T,
	ctx?: ScanContext,
	onTimeout?: () => void,
): Promise<T> {
	const timer = getTimer(ctx);
	let timeoutId: unknown;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((resolve) => {
				timeoutId = timer.setTimeout(() => {
					resolve(timeoutValue);
					onTimeout?.();
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId) timer.clearTimeout(timeoutId);
	}
}

function getTimer(ctx?: ScanContext): {
	setTimeout: (callback: () => void, delayMs: number) => unknown;
	clearTimeout: (timeoutId: unknown) => void;
} {
	return {
		setTimeout: ctx?.setTimeout ?? ((callback, delayMs) => window.setTimeout(callback, delayMs)),
		clearTimeout: ctx?.clearTimeout ?? ((timeoutId) => window.clearTimeout(timeoutId as number)),
	};
}

function makeIssue(result: CheckResult): Issue | null {
	if (result.kind === "http") {
		if (result.status < 400) return null;

		if (result.status === 401 || result.status === 403) {
			return {
				...describeFinding(
					"unverified",
					`The server returned HTTP ${result.status}, so this URL's availability could not be verified.`,
					"Open the URL in a browser — a login, paywall, or bot protection may be required.",
					"Access-restricted responses do not mean the link is dead.",
				),
				scannerId: "external-links",
				severity: "info",
				title: "External link access restricted",
				message: `HTTP ${result.status} — ${result.url}`,
				primaryPath: result.sourcePath,
				relatedPaths: [],
				evidence: {
					url: result.url,
					status: result.status,
					method: result.method,
					restricted: true,
				},
				fingerprint: generateFingerprint("external-links", result.sourcePath, {
					url: result.url,
					restricted: true,
				}),
			};
		}

		if (result.status === 429) {
			return {
				...describeFinding(
					"unverified",
					"The server rate-limited the check (HTTP 429), so this URL's availability could not be verified.",
					"Run the scan again later.",
					"Rate-limited responses do not mean the link is dead.",
				),
				scannerId: "external-links",
				severity: "info",
				title: "External link rate limited",
				message: `HTTP ${result.status} — ${result.url}`,
				primaryPath: result.sourcePath,
				relatedPaths: [],
				evidence: {
					url: result.url,
					status: result.status,
					method: result.method,
					rateLimited: true,
				},
				fingerprint: generateFingerprint("external-links", result.sourcePath, {
					url: result.url,
					rateLimited: true,
				}),
			};
		}

		if (result.status >= 500) {
			return {
				...describeFinding(
					"candidate",
					`The server reported a failure (HTTP ${result.status}).`,
					"Run the scan again later; if the failure persists, verify the URL manually.",
					"Server-side failures are often temporary and do not yet indicate a dead link.",
				),
				scannerId: "external-links",
				severity: "info",
				title: "External link server error",
				message: `HTTP ${result.status} — ${result.url}`,
				primaryPath: result.sourcePath,
				relatedPaths: [],
				evidence: {
					url: result.url,
					status: result.status,
					method: result.method,
					serverError: true,
				},
				fingerprint: generateFingerprint("external-links", result.sourcePath, {
					url: result.url,
					serverError: true,
				}),
			};
		}

		return {
			...describeFinding(
				"candidate",
				`The server returned HTTP ${result.status} for this URL.`,
				"Open the URL manually, then update or remove it if the failure persists.",
				"HTTP 404 and 410 strongly indicate the resource is gone; access restrictions, rate limits, and server failures are reported separately.",
			),
			scannerId: "external-links",
			severity: "warning",
			title: "Dead external link",
			message: `HTTP ${result.status} — ${result.url}`,
			primaryPath: result.sourcePath,
			relatedPaths: [],
			evidence: {
				url: result.url,
				status: result.status,
				method: result.method,
			},
			fingerprint: generateFingerprint("external-links", result.sourcePath, {
				url: result.url,
			}),
		};
	}

	if (result.kind === "blocked") {
		return {
			...describeFinding(
				"unverified",
				`The external-link safety policy blocked this destination (${result.reason}).`,
				"Review or correct the URL based on the reported reason, then run the scanner again.",
				"Availability was not tested because this URL was rejected before reaching the request adapter.",
			),
			scannerId: "external-links",
			severity: "info",
			title: "External link check blocked",
			message: `Blocked unsafe destination (${result.reason}) — ${result.url}`,
			primaryPath: result.sourcePath,
			relatedPaths: [],
			evidence: {
				url: result.url,
				reason: result.reason,
				blocked: true,
			},
			fingerprint: generateFingerprint("external-links", result.sourcePath, {
				url: result.url,
				blocked: true,
			}),
		};
	}

	if (result.kind === "timeout") {
		return {
			...describeFinding(
				"unverified",
				`The URL did not respond within ${result.timeoutMs}ms.`,
				"Retry the scan or open the URL manually.",
				"Slow networks and temporary server load can cause timeouts.",
			),
			scannerId: "external-links",
			severity: "info",
			title: "External link check timed out",
			message: `No response after ${result.timeoutMs}ms — ${result.url}`,
			primaryPath: result.sourcePath,
			relatedPaths: [],
			evidence: {
				url: result.url,
				timeoutMs: result.timeoutMs,
			},
			fingerprint: generateFingerprint("external-links", result.sourcePath, {
				url: result.url,
				timeout: true,
			}),
		};
	}

	return {
		...describeFinding(
			"unverified",
			"The URL check failed before an HTTP status was received.",
			"Retry the scan or open the URL manually and inspect the reported error.",
			"DNS, TLS, connectivity, and remote-server failures can be temporary.",
		),
		scannerId: "external-links",
		severity: "info",
		title: "External link check failed",
		message: `Could not check URL — ${result.url}`,
		primaryPath: result.sourcePath,
		relatedPaths: [],
		evidence: {
			url: result.url,
			error: result.error,
		},
		fingerprint: generateFingerprint("external-links", result.sourcePath, {
			url: result.url,
			failed: true,
		}),
	};
}

function withSourcePath(result: CheckResult, sourcePath: string): CheckResult {
	return { ...result, sourcePath };
}
```

Design notes for reviewers:

- The dead-link fingerprint input stays `{ url }` (byte-identical to today);
  the three new presentations get distinct inputs so ignore lists and
  lifecycle state cannot collide across classifications.
- The old `withSourcePath` three-branch body collapsed into one spread —
  every branch already returned `{ ...result, sourcePath }`.
- Timeout budget math is untouched: the fallback runs inside the same
  `withTimeout` race, so a HEAD+GET sequence that exceeds 5s total yields the
  existing `timeout` finding.

- [ ] **Step 2: Run the scanner unit tests**

```bash
npm test -- src/tests/external-links.test.ts
```

Expected: PASS. `src/tests/public-http.test.ts`, `src/tests/cli.test.ts`,
and `src/tests/scanner-precision.test.ts` still fail (later tasks): the CLI
adapter still returns a bare number and the precision assertions pin the old
uniform dead-link presentation. `src/tests/main.test.ts` may fail to compile
if it constructs a request adapter — check its failure output before
proceeding (it uses the plugin's `scanRunner` field, updated in Task 5).

---

### Task 5: Rewire the Obsidian plugin adapter

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Replace the `scanRunner` initialization**

Replace (lines 35–42):

```typescript
	scanRunner = new ScanRunner(async (url) => {
		const response = await requestUrl({ url, method: "HEAD" });
		return response.status;
	}, {
```

with:

```typescript
	scanRunner = new ScanRunner(async (url, method) => {
		const response = await requestUrl({
			url,
			method,
			headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
		});
		return { status: response.status, method };
	}, {
```

The timer wiring that follows is unchanged. Obsidian's `requestUrl` pulls the
body into its response object transiently, but only `.status` is read and
nothing body-shaped ever leaves the adapter.

---

### Task 6: Rewrite the CLI HTTP adapter

**Files:**
- Modify: `cli/public-http.ts` (full rewrite)

- [ ] **Step 1: Replace the entire file with:**

```typescript
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import {
	assessExternalHttpUrl,
	isPublicIpAddress,
} from "../src/utils/network-destination";
import type {
	ExternalHttpMethod,
	ExternalRequestResult,
} from "../src/scanner/ScanContext";

export type ResolvedAddress = {
	address: string;
	family: 4 | 6;
};

type AdapterResponse = {
	status: number;
	location?: string;
};

export type PublicHttpDependencies = {
	resolve: (hostname: string) => Promise<ResolvedAddress[]>;
	request: (
		url: URL,
		address: ResolvedAddress,
		method: ExternalHttpMethod,
		signal?: AbortSignal,
	) => Promise<AdapterResponse>;
};

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HEAD_REJECTED_STATUSES = new Set([405, 501]);
/** One-byte Range request: the fallback proves reachability only. */
const RANGE_GET_BYTES = "bytes=0-0";

const defaultDependencies: PublicHttpDependencies = {
	resolve: resolveHostname,
	request: requestAtAddress,
};

export async function requestPublicHttpStatus(
	value: string,
	signal?: AbortSignal,
	dependencies: PublicHttpDependencies = defaultDependencies,
): Promise<ExternalRequestResult> {
	let current = value;

	for (let redirects = 0; ; redirects++) {
		// Every destination — the initial URL and every redirect target —
		// re-runs the URL policy and DNS/public-IP validation before a
		// connection is opened.
		const assessment = assessExternalHttpUrl(current);
		if (!assessment.allowed) {
			throw new Error(`Blocked URL: ${assessment.reason}`);
		}

		const address = await getValidatedAddress(assessment.url, dependencies);
		const response = await dependencies.request(assessment.url, address, "HEAD", signal);
		if (HEAD_REJECTED_STATUSES.has(response.status)) {
			return requestWithRangeGetFallback(current, dependencies, signal);
		}
		if (!REDIRECT_STATUSES.has(response.status) || !response.location) {
			return { status: response.status, method: "HEAD" };
		}
		if (redirects >= MAX_REDIRECTS) {
			throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS})`);
		}

		try {
			current = new URL(response.location, assessment.url).href;
		} catch {
			throw new Error("Invalid redirect URL");
		}
	}
}

/**
 * Some origins reject HEAD with 405/501. Retry once with a one-byte Range
 * GET. The fallback re-runs the full URL and DNS/public-IP policy for the
 * destination before connecting; the response body is discarded. A redirect
 * status from the GET is returned as-is (a redirecting GET answer still
 * proves the origin serves the resource).
 */
async function requestWithRangeGetFallback(
	url: string,
	dependencies: PublicHttpDependencies,
	signal?: AbortSignal,
): Promise<ExternalRequestResult> {
	const assessment = assessExternalHttpUrl(url);
	if (!assessment.allowed) {
		throw new Error(`Blocked URL: ${assessment.reason}`);
	}

	const address = await getValidatedAddress(assessment.url, dependencies);
	const response = await dependencies.request(assessment.url, address, "GET", signal);
	return { status: response.status, method: "GET" };
}

async function getValidatedAddress(
	url: URL,
	dependencies: PublicHttpDependencies,
): Promise<ResolvedAddress> {
	const hostname = stripIpv6Brackets(url.hostname);
	const literalClassification = isPublicIpAddress(hostname);
	if (literalClassification === true) {
		return { address: hostname, family: hostname.includes(":") ? 6 : 4 };
	}

	const addresses = await dependencies.resolve(hostname);
	if (addresses.length === 0) {
		throw new Error("DNS returned no addresses");
	}
	if (addresses.some(({ address }) => isPublicIpAddress(address) !== true)) {
		throw new Error("DNS resolved to a non-public IP address");
	}

	return addresses[0];
}

async function resolveHostname(hostname: string): Promise<ResolvedAddress[]> {
	const addresses = await lookup(hostname, { all: true, verbatim: true });
	return addresses.map(({ address, family }) => {
		if (family !== 4 && family !== 6) {
			throw new Error(`Unsupported DNS address family: ${family}`);
		}
		return { address, family };
	});
}

function requestAtAddress(
	url: URL,
	address: ResolvedAddress,
	method: ExternalHttpMethod,
	signal?: AbortSignal,
): Promise<AdapterResponse> {
	return new Promise((resolve, reject) => {
		const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
		const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
			if (options.all) {
				callback(null, [address]);
				return;
			}
			callback(null, address.address, address.family);
		};
		const request = transport(url, {
			method,
			signal,
			lookup: pinnedLookup,
			headers: method === "GET" ? { Range: RANGE_GET_BYTES } : undefined,
		}, (response: IncomingMessage) => {
			const result: AdapterResponse = {
				status: response.statusCode ?? 0,
			};
			if (response.headers.location) result.location = response.headers.location;
			// The body is consumed and discarded — never materialized.
			response.resume();
			resolve(result);
		});
		request.on("error", reject);
		request.end();
	});
}

function stripIpv6Brackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]")
		? hostname.slice(1, -1)
		: hostname;
}
```

---

### Task 7: Rewrite the adapter tests

**Files:**
- Modify: `src/tests/public-http.test.ts` (full rewrite)

```typescript
import { describe, expect, it, vi } from "vitest";
import {
	requestPublicHttpStatus,
	type PublicHttpDependencies,
} from "../../cli/public-http";

function makeDependencies(
	overrides: Partial<PublicHttpDependencies> = {},
): PublicHttpDependencies {
	return {
		resolve: vi.fn(async () => [{ address: "93.184.216.34", family: 4 as const }]),
		request: vi.fn(async () => ({ status: 200 })),
		...overrides,
	};
}

describe("requestPublicHttpStatus", () => {
	it("rejects private DNS answers before opening a connection", async () => {
		const dependencies = makeDependencies({
			resolve: vi.fn(async () => [{ address: "127.0.0.1", family: 4 as const }]),
		});

		await expect(requestPublicHttpStatus(
			"https://example.com/",
			undefined,
			dependencies,
		)).rejects.toThrow("DNS resolved to a non-public IP address");
		expect(dependencies.request).not.toHaveBeenCalled();
	});

	it("fails closed when DNS returns a mix of public and private addresses", async () => {
		const dependencies = makeDependencies({
			resolve: vi.fn(async () => [
				{ address: "93.184.216.34", family: 4 as const },
				{ address: "10.0.0.1", family: 4 as const },
			]),
		});

		await expect(requestPublicHttpStatus(
			"https://example.com/",
			undefined,
			dependencies,
		)).rejects.toThrow("DNS resolved to a non-public IP address");
		expect(dependencies.request).not.toHaveBeenCalled();
	});

	it("pins the HEAD request to the validated public address", async () => {
		const dependencies = makeDependencies({
			request: vi.fn(async () => ({ status: 204 })),
		});

		await expect(requestPublicHttpStatus(
			"https://example.com/health",
			undefined,
			dependencies,
		)).resolves.toEqual({ status: 204, method: "HEAD" });
		expect(dependencies.request).toHaveBeenCalledWith(
			expect.objectContaining({ hostname: "example.com", pathname: "/health" }),
			{ address: "93.184.216.34", family: 4 },
			"HEAD",
			undefined,
		);
	});

	it("revalidates a relative redirect before the next HEAD request", async () => {
		const request = vi.fn()
			.mockResolvedValueOnce({ status: 302, location: "/moved" })
			.mockResolvedValueOnce({ status: 200 });
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/start",
			undefined,
			dependencies,
		)).resolves.toEqual({ status: 200, method: "HEAD" });
		expect(request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ href: "https://example.com/moved" }),
			{ address: "93.184.216.34", family: 4 },
			"HEAD",
			undefined,
		);
	});

	it("blocks a public-to-private redirect before a second request", async () => {
		const request = vi.fn(async () => ({
			status: 302,
			location: "http://127.0.0.1/admin",
		}));
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/start",
			undefined,
			dependencies,
		)).rejects.toThrow("Blocked URL: non-public IP address");
		expect(request).toHaveBeenCalledTimes(1);
		expect(dependencies.resolve).toHaveBeenCalledTimes(1);
	});

	it("limits redirect chains to five hops", async () => {
		const request = vi.fn(async () => ({ status: 302, location: "/again" }));
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/start",
			undefined,
			dependencies,
		)).rejects.toThrow("Too many redirects");
		expect(request).toHaveBeenCalledTimes(6);
	});

	it("passes the caller's abort signal to the pinned request", async () => {
		const controller = new AbortController();
		const request = vi.fn(async () => ({ status: 200 }));
		const dependencies = makeDependencies({ request });

		await requestPublicHttpStatus(
			"https://example.com/",
			controller.signal,
			dependencies,
		);

		expect(request).toHaveBeenCalledWith(
			expect.any(URL),
			{ address: "93.184.216.34", family: 4 },
			"HEAD",
			controller.signal,
		);
	});

	it("falls back to a Range GET when HEAD is rejected with 405, revalidating the destination", async () => {
		const request = vi.fn()
			.mockResolvedValueOnce({ status: 405 })
			.mockResolvedValueOnce({ status: 200 });
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/headless",
			undefined,
			dependencies,
		)).resolves.toEqual({ status: 200, method: "GET" });

		expect(request).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ pathname: "/headless" }),
			{ address: "93.184.216.34", family: 4 },
			"HEAD",
			undefined,
		);
		expect(request).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ pathname: "/headless" }),
			{ address: "93.184.216.34", family: 4 },
			"GET",
			undefined,
		);
		// The fallback re-runs the DNS/public-IP checks before connecting.
		expect(dependencies.resolve).toHaveBeenCalledTimes(2);
	});

	it("falls back to a Range GET when HEAD is rejected with 501", async () => {
		const request = vi.fn()
			.mockResolvedValueOnce({ status: 501 })
			.mockResolvedValueOnce({ status: 404 });
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/headless",
			undefined,
			dependencies,
		)).resolves.toEqual({ status: 404, method: "GET" });
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("does not fall back for statuses other than 405 or 501", async () => {
		const request = vi.fn(async () => ({ status: 404 }));
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/gone",
			undefined,
			dependencies,
		)).resolves.toEqual({ status: 404, method: "HEAD" });
		expect(request).toHaveBeenCalledTimes(1);
		expect(dependencies.resolve).toHaveBeenCalledTimes(1);
	});

	it("applies the fallback to the final redirect destination", async () => {
		const request = vi.fn()
			.mockResolvedValueOnce({ status: 302, location: "/final" })
			.mockResolvedValueOnce({ status: 405 })
			.mockResolvedValueOnce({ status: 200 });
		const dependencies = makeDependencies({ request });

		await expect(requestPublicHttpStatus(
			"https://example.com/start",
			undefined,
			dependencies,
		)).resolves.toEqual({ status: 200, method: "GET" });
		expect(request).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({ href: "https://example.com/final" }),
			{ address: "93.184.216.34", family: 4 },
			"GET",
			undefined,
		);
	});
});
```

Note: the `Range: bytes=0-0` header itself is applied inside the default
`requestAtAddress` transport (not reachable through the injectable
`request` double without a real socket); it is pinned by the code in
Task 6 and by the Obsidian adapter path, and the fallback *behavior*
(method, revalidation, result shape) is covered by the tests above.

- [ ] **Step 2: Run the adapter tests**

```bash
npm test -- src/tests/public-http.test.ts
```

Expected: PASS (11 tests).

---

### Task 8: Update the CLI wiring and CLI tests

**Files:**
- Modify: `cli/cli.ts`
- Modify: `src/tests/helpers/fixture-vault.ts`
- Modify: `src/tests/cli.test.ts`

- [ ] **Step 1: Update the runtime override type in `cli/cli.ts`**

Extend the imports with the contract type (next to the existing
`requestPublicHttpStatus` import):

```typescript
import type { ExternalRequestAdapter } from "../src/scanner/ScanContext";
```

and replace the runtime type (line 49):

```typescript
	requestUrl?: (url: string, signal?: AbortSignal) => Promise<number>;
```

with:

```typescript
	requestUrl?: ExternalRequestAdapter;
```

The `new ScanRunner(runtime.requestUrl ?? requestPublicHttpStatus, ...)` line
needs no change — both sides now implement the same contract.

- [ ] **Step 2: Update the fixture-vault helper type in `src/tests/helpers/fixture-vault.ts`**

Replace (line 23):

```typescript
	requestUrl?: (url: string, signal?: AbortSignal) => Promise<number>;
```

with:

```typescript
	requestUrl?: ExternalRequestAdapter;
```

and extend its `ScanContext` import to include `ExternalRequestAdapter`
(the file already imports types from `../scanner/ScanContext`; add the name
to that import).

- [ ] **Step 3: Update the CLI external-link tests in `src/tests/cli.test.ts`**

Three targeted edits.

Edit 1 — "checks external links in CLI scans with the secured request adapter"
(lines 778 and 795–798). Replace:

```typescript
		const requestUrl = vi.fn(async () => 404);
```

with:

```typescript
		const requestUrl = vi.fn(async () => ({ status: 404, method: "HEAD" as const }));
```

and replace:

```typescript
				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/dead",
					expect.any(AbortSignal),
				);
```

with:

```typescript
				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/dead",
					"HEAD",
					expect.any(AbortSignal),
				);
```

Edit 2 — "checks bare external URLs in CLI scans" (lines 818 and 832–835).
Replace:

```typescript
		const requestUrl = vi.fn(async () => 404);
```

with:

```typescript
		const requestUrl = vi.fn(async () => ({ status: 404, method: "HEAD" as const }));
```

and replace:

```typescript
				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/bare",
					expect.any(AbortSignal),
				);
```

with:

```typescript
				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/bare",
					"HEAD",
					expect.any(AbortSignal),
				);
```

Edit 3 — "aborts timed out CLI external-link requests" (lines 901–908 and
923–926). Replace:

```typescript
		const requestUrl = vi.fn(
			(_url: string, signal?: AbortSignal) => new Promise<number>((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					aborted = true;
					reject(new DOMException("The operation was aborted", "AbortError"));
				});
			}),
		);
```

with:

```typescript
		const requestUrl = vi.fn(
			(_url: string, _method: "HEAD" | "GET", signal?: AbortSignal) =>
				new Promise<{ status: number; method: "HEAD" | "GET" }>((_resolve, reject) => {
					signal?.addEventListener("abort", () => {
						aborted = true;
						reject(new DOMException("The operation was aborted", "AbortError"));
					});
				}),
		);
```

and replace:

```typescript
				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/slow",
					expect.any(AbortSignal),
				);
```

with:

```typescript
				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/slow",
					"HEAD",
					expect.any(AbortSignal),
				);
```

- [ ] **Step 4: Run the CLI tests**

```bash
npm test -- src/tests/cli.test.ts
```

Expected: PASS. The dead-link assertions in these tests use
`evidence.status`/`evidence.url`, which are unchanged for 404 findings; the
"keeps external link checks disabled in default CLI scans" test needs no
edit (its `fetchMock` never fires and external-links stays disabled).

---

### Task 9: Bump COMPARISON_VERSION and update snapshot tests

**Files:**
- Modify: `src/snapshot/scan-snapshot.ts`
- Modify: `src/tests/scan-snapshot.test.ts`
- Modify: `src/tests/result-diff.test.ts`

401/403/429/5xx findings change fingerprint identity
(`{ url }` dead-link → `{ url, restricted | rateLimited | serverError }`), so
old snapshots would mislabel them as resolved — a genuine detection-semantics
change. Per the roadmap rule, bump the comparison version.

- [ ] **Step 1: Bump the constant in `src/snapshot/scan-snapshot.ts`**

Replace (line 12):

```typescript
export const COMPARISON_VERSION = 1;
```

with:

```typescript
/**
 * 2 — external-link outcomes are classified per status (404/410 dead-link
 * candidates, 401/403 access-restricted, 429 rate-limited, 5xx server
 * error). Fingerprints for the reclassified findings changed identity, so
 * pre-2 snapshots cannot be compared without false resolved/new claims.
 */
export const COMPARISON_VERSION = 2;
```

- [ ] **Step 2: Update `src/tests/scan-snapshot.test.ts`**

Replace (lines 66–69):

```typescript
		expect(COMPARISON_VERSION).toBe(1);
		expect(snapshot).toEqual({
			schemaVersion: 1,
			comparisonVersion: 1,
```

with:

```typescript
		expect(COMPARISON_VERSION).toBe(2);
		expect(snapshot).toEqual({
			schemaVersion: 1,
			comparisonVersion: 2,
```

The `snapshot.comparisonVersion = COMPARISON_VERSION + 1` mutation (line 154)
and the `isScanSnapshot({ schemaVersion: 1, comparisonVersion: 1 })` guard
(line 340, rejected for missing required keys, not the version value) need
no change.

- [ ] **Step 3: Update `src/tests/result-diff.test.ts`**

Extend the import from `"../snapshot/scan-snapshot"` to include
`COMPARISON_VERSION`, then:

Replace (line 59, "rejects changed comparison semantics" test):

```typescript
			comparisonVersion: 2,
```

with:

```typescript
			comparisonVersion: 3,
```

and replace (line 146, the 10,000-fingerprint snapshot literal):

```typescript
			comparisonVersion: 1,
```

with:

```typescript
			comparisonVersion: COMPARISON_VERSION,
```

so the test tracks the current version instead of pinning `1`.

- [ ] **Step 4: Run the snapshot suites**

```bash
npm test -- src/tests/scan-snapshot.test.ts src/tests/result-diff.test.ts src/tests/plugin-data.test.ts src/tests/main.test.ts
```

Expected: PASS (`plugin-data.test.ts` uses `COMPARISON_VERSION + 1` and
`main.test.ts` mutates the stored version — both version-agnostic).

---

### Task 10: Update the precision suite (assertions only)

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

Fixture files stay unchanged; the stub adapter gains the method-aware shape
and the four `>= 400` statuses get their new presentations.

- [ ] **Step 1: Replace the whole `describe("external links", ...)` block (lines 297–395)**

Replace:

```typescript
	describe("external links", () => {
		const EXTERNAL_STATUS_BY_URL: Record<string, number> = {
			"https://status-200.example.com/ok": 200,
			"https://status-404.example.com/gone": 404,
			"https://status-403.example.com/private": 403,
			"https://status-429.example.com/slow-down": 429,
			"https://status-500.example.com/server-error": 500,
		};

		const stubRequestUrl = async (url: string): Promise<number> => {
			if (url === "https://request-error.example.com/network-failure") {
				throw new Error("simulated network failure");
			}
			const status = EXTERNAL_STATUS_BY_URL[url];
			if (status === undefined) {
				throw new Error(
					`unexpected URL in external fixture: ${url} (expected one of: ${Object.keys(EXTERNAL_STATUS_BY_URL).join(", ")})`,
				);
			}
			return status;
		};

		const externalScan = () =>
			scanFixtureVault({
				requestUrl: stubRequestUrl,
				settings: {
					enabledScanners: {
						...DEFAULT_SETTINGS.enabledScanners,
						"external-links": true,
					},
				},
			}).then(({ issues }) =>
				issues.filter((issue) => issue.scannerId === "external-links"),
			);

		it("presents every >= 400 status as the same dead-link candidate — Milestone 1.6 target", async () => {
			const external = await externalScan();
			const dead = external.filter((issue) => issue.title === "Dead external link");
			expect(dead).toHaveLength(4);
			const byUrl = new Map(dead.map((issue) => [issue.evidence.url as string, issue]));
			expect(byUrl.size).toBe(4);
			expect(
				byUrl.get("https://status-403.example.com/private"),
			).toMatchObject({
				severity: "warning",
				classification: "candidate",
				evidence: { status: 403 },
			});
			expect(byUrl.get("https://status-404.example.com/gone")).toMatchObject({
				severity: "warning",
				classification: "candidate",
				evidence: { status: 404 },
			});
			expect(
				byUrl.get("https://status-429.example.com/slow-down"),
			).toMatchObject({
				severity: "warning",
				classification: "candidate",
				evidence: { status: 429 },
			});
			expect(
				byUrl.get("https://status-500.example.com/server-error"),
			).toMatchObject({
				severity: "warning",
				classification: "candidate",
				evidence: { status: 500 },
			});
			expect(dead.every((issue) => issue.primaryPath === "notes/external-links.md")).toBe(true);
		});

		it("stays silent for the healthy URL", async () => {
			const external = await externalScan();
			expect(
				external.some(
					(issue) => issue.evidence.url === "https://status-200.example.com/ok",
				),
			).toBe(false);
		});

		it("marks request failures and blocked destinations as unverified", async () => {
			const external = await externalScan();
			const unverified = external.filter(
				(issue) => issue.classification === "unverified",
			);
			expect(unverified).toHaveLength(2);
			expect(unverified.every((issue) => issue.severity === "info")).toBe(true);
			const failed = unverified.find(
				(issue) => issue.evidence.url === "https://request-error.example.com/network-failure",
			);
			expect(failed?.title).toBe("External link check failed");
			const blocked = unverified.find(
				(issue) => issue.evidence.url === "http://127.0.0.1:9/internal-service",
			);
			expect(blocked?.title).toBe("External link check blocked");
			expect(blocked?.evidence.blocked).toBe(true);
		});
	});
```

with:

```typescript
	describe("external links", () => {
		const EXTERNAL_STATUS_BY_URL: Record<string, number> = {
			"https://status-200.example.com/ok": 200,
			"https://status-404.example.com/gone": 404,
			"https://status-403.example.com/private": 403,
			"https://status-429.example.com/slow-down": 429,
			"https://status-500.example.com/server-error": 500,
		};

		const stubRequestUrl = async (
			url: string,
			method: "HEAD" | "GET",
		): Promise<{ status: number; method: "HEAD" | "GET" }> => {
			if (url === "https://request-error.example.com/network-failure") {
				throw new Error("simulated network failure");
			}
			const status = EXTERNAL_STATUS_BY_URL[url];
			if (status === undefined) {
				throw new Error(
					`unexpected URL in external fixture: ${url} (expected one of: ${Object.keys(EXTERNAL_STATUS_BY_URL).join(", ")})`,
				);
			}
			return { status, method };
		};

		const externalScan = () =>
			scanFixtureVault({
				requestUrl: stubRequestUrl,
				settings: {
					enabledScanners: {
						...DEFAULT_SETTINGS.enabledScanners,
						"external-links": true,
					},
				},
			}).then(({ issues }) =>
				issues.filter((issue) => issue.scannerId === "external-links"),
			);

		it("classifies external-link failures per the status policy — Milestone 1.6", async () => {
			const external = await externalScan();
			const byUrl = new Map(external.map((issue) => [issue.evidence.url as string, issue]));
			expect(byUrl.size).toBe(5);

			// 404 stays a dead-link candidate.
			expect(byUrl.get("https://status-404.example.com/gone")).toMatchObject({
				severity: "warning",
				classification: "candidate",
				title: "Dead external link",
				evidence: { status: 404, method: "HEAD" },
			});
			// 403 is access-restricted, not dead.
			expect(byUrl.get("https://status-403.example.com/private")).toMatchObject({
				severity: "info",
				classification: "unverified",
				title: "External link access restricted",
				evidence: { status: 403, restricted: true },
			});
			// 429 is rate-limited, not dead.
			expect(byUrl.get("https://status-429.example.com/slow-down")).toMatchObject({
				severity: "info",
				classification: "unverified",
				title: "External link rate limited",
				evidence: { status: 429, rateLimited: true },
			});
			// 5xx is a candidate temporary server failure.
			expect(
				byUrl.get("https://status-500.example.com/server-error"),
			).toMatchObject({
				severity: "info",
				classification: "candidate",
				title: "External link server error",
				evidence: { status: 500, serverError: true },
			});
			expect(
				external.every((issue) => issue.primaryPath === "notes/external-links.md"),
			).toBe(true);
		});

		it("stays silent for the healthy URL", async () => {
			const external = await externalScan();
			expect(
				external.some(
					(issue) => issue.evidence.url === "https://status-200.example.com/ok",
				),
			).toBe(false);
		});

		it("marks request failures, blocks, restrictions, and rate limits as unverified", async () => {
			const external = await externalScan();
			const unverified = external.filter(
				(issue) => issue.classification === "unverified",
			);
			// failed + blocked (previously) and the newly reclassified 403/429.
			expect(unverified).toHaveLength(4);
			expect(unverified.every((issue) => issue.severity === "info")).toBe(true);
			const failed = unverified.find(
				(issue) => issue.evidence.url === "https://request-error.example.com/network-failure",
			);
			expect(failed?.title).toBe("External link check failed");
			const blocked = unverified.find(
				(issue) => issue.evidence.url === "http://127.0.0.1:9/internal-service",
			);
			expect(blocked?.title).toBe("External link check blocked");
			expect(blocked?.evidence.blocked).toBe(true);
		});
	});
```

- [ ] **Step 2: Run the precision suite**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS. `EXPECTED_INVENTORY` is untouched — the default-scan
inventory excludes external-links (it is disabled by default, pinned by the
existing "not.toContain('external-links')" assertion at the top of the
file).

---

### Task 11: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/external-links.test.ts src/tests/public-http.test.ts src/tests/cli.test.ts
```

Expected: PASS — access-control, rate-limit, and temporary server responses
are no longer labeled dead links, and the HEAD fallback cannot bypass the
SSRF destination checks (scanner re-assesses before the fallback; the CLI
adapter re-assesses and re-resolves before every connection).

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0. `npm run build` compiles both the plugin bundle and
the CLI (`cli/` is outside the Obsidian warning lint scope, but `tsc` type
checks it — the `ExternalRequestAdapter` import in `cli/public-http.ts` is
type-only, so no Obsidian runtime code leaks into the CLI bundle).

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/scanner/ScanContext.ts`,
`src/scanner/ScanRunner.ts`, `src/scanner/scanners/external-links.ts`,
`src/main.ts`, `cli/public-http.ts`, `cli/cli.ts`,
`src/snapshot/scan-snapshot.ts`,
`src/tests/helpers/fixture-vault.ts`, `src/tests/external-links.test.ts`,
`src/tests/public-http.test.ts`, `src/tests/cli.test.ts`,
`src/tests/scan-snapshot.test.ts`, `src/tests/result-diff.test.ts`,
`src/tests/scanner-precision.test.ts`. NOT any fixture file under
`src/tests/fixtures/`, nor `src/report/*`, `src/fix/*`, `src/settings/*`,
`src/scanner/finding-presentation.ts`, or `src/scanner/issue-fingerprint.ts`.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/ScanContext.ts src/scanner/ScanRunner.ts src/scanner/scanners/external-links.ts src/main.ts cli/public-http.ts cli/cli.ts src/snapshot/scan-snapshot.ts src/tests/helpers/fixture-vault.ts src/tests/external-links.test.ts src/tests/public-http.test.ts src/tests/cli.test.ts src/tests/scan-snapshot.test.ts src/tests/result-diff.test.ts src/tests/scanner-precision.test.ts
git commit -m "fix: classify external link failures accurately"
git push -u origin fix/external-link-classification
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `fix: classify external link failures accurately`, covering: status policy
  implemented (404/410 and other 4xx stay dead-link candidates; 401/403
  access-restricted; 429 rate-limited; 5xx candidate server error;
  timeout/failure unverified; safety blocks unverified-and-blocked);
  method-aware adapter contract (`ExternalRequestAdapter` returning
  `{ status, method }`, never a body); HEAD-first with a one-byte Range GET
  fallback only for 405/501; URL/DNS/redirect/public-IP checks re-run for
  every fallback and redirect destination (scanner-side URL re-assessment
  plus adapter-side revalidation, pinned DNS in the CLI adapter); timeout,
  scan budget, and batching unchanged; external-links still disabled by
  default; `COMPARISON_VERSION` bumped to 2 with the mislabeling rationale
  (dead-link fingerprints unchanged, reclassified findings get distinct
  fingerprints); precision fixtures untouched (assertion updates only);
  focused tests plus full gates run.

## Self-review checklist (completed during plan writing)

- Roadmap Task 1.6 requirements ↔ tasks: status-only adapter replaced ✓ (Task 3 `ExternalRequestAdapter` in `ScanContext.ts`, threaded through `ScanRunner`, `main.ts`, `cli/cli.ts`, `cli/public-http.ts`, and the fixture helper); HEAD first with bounded Range GET fallback only for 405/501 ✓ (Task 4 `HEAD_REJECTED_STATUSES` in the scanner, Task 6 fallback in the CLI adapter with `Range: bytes=0-0`); bodies never retained ✓ (result contract has no body field; Node adapter `response.resume()`; Obsidian adapter reads only `.status`); URL/DNS/redirect/public-IP checks re-run for every fallback and redirect destination ✓ (CLI adapter re-assesses + re-resolves per hop and per fallback — Task 7 pins `resolve` called twice on fallback; scanner re-assesses the URL policy before the fallback call, covering injected adapters); timeout/budget/batching preserved ✓ (constants and `checkUrls` untouched; the fallback runs inside the existing per-URL `withTimeout` race and one batch slot); disabled by default ✓ (no settings change; the default-scan CLI test still pins `scannersRun` without external-links).
- Status policy table ↔ issue shapes: 404/410 → candidate dead link (warning); 401/403 → access-restricted (info, unverified); 429 → rate-limited (info, unverified); 5xx → candidate temporary server failure (info, candidate); timeout/failure → unverified; block → unverified and blocked — all six rows implemented in Task 4's `makeIssue` and pinned by Task 2 and Task 10 tests.
- Roadmap focused-verification command reproduced in Task 11 Step 1 with the roadmap's expected outcome.
- No placeholders: full rewrites ship complete code for `external-links.test.ts`, `external-links.ts`, `public-http.ts`, `public-http.test.ts`; `ScanContext.ts`, `ScanRunner.ts`, `main.ts`, `cli/cli.ts`, `fixture-vault.ts`, `scan-snapshot.ts`, and the three test-file edits quote the exact current file contents before replacement (verified against `src/scanner/ScanContext.ts` line 9, `src/scanner/ScanRunner.ts` lines 3/27, `src/main.ts` lines 35–42, `cli/cli.ts` line 49, `src/tests/helpers/fixture-vault.ts` line 23, `src/snapshot/scan-snapshot.ts` line 12, `src/tests/scan-snapshot.test.ts` lines 66–69, `src/tests/result-diff.test.ts` lines 59/146, `src/tests/cli.test.ts` lines 778/795–798/818/832–835/901–908/923–926, `src/tests/scanner-precision.test.ts` lines 297–395).
- Type/name consistency verified against the codebase: `requestUrl` flows `main.ts` → `ScanRunner` constructor → `ScanContext.requestUrl` → `checkUrl`; the CLI default adapter is `requestPublicHttpStatus` (now conforming to `ExternalRequestAdapter` after the Task 6 return-type change); `describeFinding(classification, why, nextStep, caveat?)` and `generateFingerprint` signatures unchanged; the obsidian test mock's `requestUrl` is a `vi.fn()` returning whatever the test sets (`{ status: 404 }`), so the makeCtx adapter's `response.status` read works.
- Fingerprint decision: dead-link input stays `{ url }` (identical for 404/410, so ignores survive); 401/403/429/5xx get `{ url, restricted | rateLimited | serverError: true }` — a genuine identity change, so `COMPARISON_VERSION` bumps 1 → 2 per the roadmap's cross-cutting rule; `compareScanResult` already degrades to `unavailable("semantics-changed")`, and the affected tests (`scan-snapshot.test.ts` pin, `result-diff.test.ts` literals) are updated in Task 9.
- Precision-suite flips planned: 403 → access-restricted unverified, 429 → rate-limited unverified, 500 → server-error candidate (info), 404 stays dead-link candidate with `method: "HEAD"` evidence; unverified count assertion moves 2 → 4; inventory unchanged (default scan excludes external-links).
- Deviations from the roadmap's file list, documented: `src/scanner/ScanContext.ts`, `src/scanner/ScanRunner.ts`, `src/snapshot/scan-snapshot.ts`, `src/tests/helpers/fixture-vault.ts`, `src/tests/scan-snapshot.test.ts`, `src/tests/result-diff.test.ts`, and `src/tests/scanner-precision.test.ts` change alongside the roadmap's six files — all are mechanical consequences of the contract change, the version bump, and the precision-fixture freeze; no behavior beyond Task 1.6 is introduced.
- Known limitation recorded: the Range header itself is asserted only via code (the injectable request double bypasses the real transport); Obsidian's `requestUrl` follows redirects internally, so plugin-side redirect revalidation is impossible today — the adapter contract documents revalidation as required so the obligation lives in one place.
