import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";

export const orphanNotesScanner = {
	id: "orphan-notes" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const linkedPaths = collectLinkedMarkdownPaths(ctx);

		for (const file of ctx.markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;
			if (linkedPaths.has(file.path)) continue;

			issues.push({
				scannerId: "orphan-notes",
				severity: "info",
				title: "Orphan note",
				message: "This note has no inbound links from other notes",
				primaryPath: file.path,
				relatedPaths: [],
				evidence: {
					lastModified: file.stat.mtime,
				},
				fingerprint: generateFingerprint("orphan-notes", file.path, {
					orphan: true,
				}),
			});
		}

		return issues;
	},
};

function collectLinkedMarkdownPaths(ctx: ScanContext): Set<string> {
	const paths = new Set<string>();

	for (const file of ctx.markdownFiles) {
		const cache = ctx.metadataCache.getFileCache(file);
		if (!cache) continue;

		const links = cache.links ?? [];
		const embeds = cache.embeds ?? [];

		for (const link of [...links, ...embeds]) {
			const target = link.link.split("#")[0].split("|")[0];
			if (!target) continue;

			const candidates = [target, target + ".md"];
			for (const candidate of candidates) {
				if (ctx.filePathIndex.has(candidate) && candidate.endsWith(".md")) {
					paths.add(candidate);
				}
			}

			const resolvedMeta = ctx.metadataCache as unknown as {
				resolvedLinks?: Record<string, Record<string, string>>;
			};
			const resolved = resolvedMeta.resolvedLinks?.[file.path]?.[link.link];
			if (typeof resolved === "string" && resolved.endsWith(".md")) {
				paths.add(resolved);
			}
		}
	}

	return paths;
}
