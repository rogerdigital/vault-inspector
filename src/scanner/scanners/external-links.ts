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
