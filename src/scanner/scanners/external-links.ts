import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";

export const externalLinksScanner = {
	id: "external-links" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];
		const urlMap = collectExternalUrls(ctx);
		const { results, skipped } = await checkUrls(urlMap, ctx);

		for (const result of results) {
			const issue = makeIssue(result);
			if (issue) issues.push(issue);
		}

		if (skipped > 0) {
			issues.push({
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

type UrlEntry = { url: string; sourcePath: string };
type CheckResult =
	| (UrlEntry & { kind: "http"; status: number })
	| (UrlEntry & { kind: "timeout"; timeoutMs: number })
	| (UrlEntry & { kind: "failed"; error: string });

function collectExternalUrls(ctx: ScanContext): UrlEntry[] {
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
	}

	return entries;
}

function isExternalUrl(text: string): boolean {
	return /^https?:\/\//i.test(text);
}

async function checkUrls(
	urlMap: UrlEntry[],
	ctx?: ScanContext,
): Promise<{ results: CheckResult[]; skipped: number }> {
	const results: CheckResult[] = [];
	const startedAt = Date.now();
	const deadline = startedAt + EXTERNAL_LINK_SCAN_BUDGET_MS;

	for (let i = 0; i < urlMap.length; i += EXTERNAL_LINK_BATCH_SIZE) {
		if (Date.now() >= deadline) {
			return { results, skipped: urlMap.length - i };
		}

		const timeoutMs = Math.max(1, Math.min(EXTERNAL_LINK_TIMEOUT_MS, deadline - Date.now()));
		const batch = urlMap.slice(i, i + EXTERNAL_LINK_BATCH_SIZE);
		const checks = batch.map((entry) => checkUrlWithTimeout(entry, ctx, timeoutMs));
		results.push(...await Promise.all(checks));
	}

	return { results, skipped: 0 };
}

async function checkUrlWithTimeout(
	entry: UrlEntry,
	ctx: ScanContext | undefined,
	timeoutMs: number,
): Promise<CheckResult> {
	const result = await withTimeout(checkUrl(entry.url, ctx), timeoutMs, {
		...entry,
		kind: "timeout",
		timeoutMs,
	});
	return withSourcePath(result, entry.sourcePath);
}

async function checkUrl(url: string, ctx?: ScanContext): Promise<CheckResult> {
	try {
		if (ctx?.requestUrl) {
			const status = await ctx.requestUrl(url);
			return { url, sourcePath: "", kind: "http", status };
		}
		const response = await fetch(url, { method: "HEAD" });
		return { url, sourcePath: "", kind: "http", status: response.status };
	} catch (error) {
		return {
			url,
			sourcePath: "",
			kind: "failed",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	timeoutValue: T,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((resolve) => {
				timeoutId = setTimeout(() => resolve(timeoutValue), timeoutMs);
			}),
		]);
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

function makeIssue(result: CheckResult): Issue | null {
	if (result.kind === "http") {
		if (result.status < 400) return null;
		return {
			scannerId: "external-links",
			severity: "warning",
			title: "Dead external link",
			message: `HTTP ${result.status} — ${result.url}`,
			primaryPath: result.sourcePath,
			relatedPaths: [],
			evidence: {
				url: result.url,
				status: result.status,
			},
			fingerprint: generateFingerprint("external-links", result.sourcePath, {
				url: result.url,
			}),
		};
	}

	if (result.kind === "timeout") {
		return {
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
	if (result.kind === "http") {
		return { ...result, sourcePath };
	}
	if (result.kind === "timeout") {
		return { ...result, sourcePath };
	}
	return { ...result, sourcePath };
}
