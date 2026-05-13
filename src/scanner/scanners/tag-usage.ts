import type { CachedMetadata } from "obsidian";
import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";

export const tagUsageScanner = {
	id: "tag-usage" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const tagCounts = new Map<string, number>();
		const watchedSet = new Set(ctx.watchedTags);

		// Collect tags from metadata (tags frontmatter field and inline tags)
		for (const file of ctx.markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const cache = ctx.metadataCache.getFileCache(file);
			if (!cache) continue;

			const tags = collectTags(cache);
			for (const tag of tags) {
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}

		// Report low-usage tags
		for (const [tag, count] of tagCounts) {
			if (count >= ctx.lowUsageTagThreshold) continue;
			if (watchedSet.has(tag)) continue; // watched tags reported separately

			issues.push({
				scannerId: "tag-usage",
				severity: "info",
				title: "Low-usage tag",
				message: `Tag "${tag}" is only used ${count} time(s), below threshold of ${ctx.lowUsageTagThreshold}`,
				relatedPaths: [],
				evidence: { tag, count, threshold: ctx.lowUsageTagThreshold },
				fingerprint: generateFingerprint("tag-usage", undefined, {
					tag,
					lowUsage: true,
				}),
			});
		}

		// Report watched tags that do not appear in the vault
		for (const watchedTag of ctx.watchedTags) {
			const count = tagCounts.get(watchedTag) ?? 0;
			if (count > 0) continue;
			issues.push({
				scannerId: "tag-usage",
				severity: "info",
				title: "Missing watched tag",
				message: `Watched tag "${watchedTag}" does not appear in the vault`,
				relatedPaths: [],
				evidence: { tag: watchedTag, count: 0, watched: true },
				fingerprint: generateFingerprint("tag-usage", undefined, {
					tag: watchedTag,
					watched: true,
				}),
			});
		}

		return issues;
	},
};

function collectTags(cache: CachedMetadata): string[] {
	const tags: string[] = [];

	// Frontmatter tags (tags: [tag1, tag2] or tags: tag)
	const frontmatterTags: unknown = cache.frontmatter?.tags;
	if (frontmatterTags) {
		if (Array.isArray(frontmatterTags)) {
			for (const t of frontmatterTags) {
				tags.push(String(t).replace(/^#/, ""));
			}
		} else if (typeof frontmatterTags === "string" || typeof frontmatterTags === "number") {
			tags.push(String(frontmatterTags).replace(/^#/, ""));
		}
	}

	// Inline tags from tags cache
	const inlineTags = cache.tags;
	if (inlineTags) {
		for (const t of inlineTags) {
			tags.push(t.tag.replace(/^#/, ""));
		}
	}

	return tags;
}
