import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";

export const externalLinksScanner = {
	id: "external-links" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];
		const urlMap = collectExternalUrls(ctx);
		const results = await checkUrls(urlMap, ctx);

		for (const result of results) {
			issues.push({
				scannerId: "external-links",
				severity: result.status >= 400 ? "warning" : "info",
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
			});
		}

		return issues;
	},
};

type UrlEntry = { url: string; sourcePath: string };
type CheckResult = UrlEntry & { status: number };

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

async function checkUrls(urlMap: UrlEntry[], ctx?: ScanContext): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	const batchSize = 5;

	for (let i = 0; i < urlMap.length; i += batchSize) {
		const batch = urlMap.slice(i, i + batchSize);
		const checks = batch.map(async (entry) => {
			const status = await checkUrl(entry.url, ctx);
			if (status >= 400) {
				results.push({ ...entry, status });
			}
		});
		await Promise.all(checks);
	}

	return results;
}

async function checkUrl(url: string, ctx?: ScanContext): Promise<number> {
	try {
		if (ctx?.requestUrl) return await ctx.requestUrl(url);
		const response = await fetch(url, { method: "HEAD" });
		return response.status;
	} catch {
		return 0;
	}
}
