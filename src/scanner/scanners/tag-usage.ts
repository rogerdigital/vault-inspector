import type { CachedMetadata } from "obsidian";
import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";
import { normalizeTagName } from "../../utils/tags";

export const tagUsageScanner = {
	id: "tag-usage" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const tagCounts = new Map<string, number>();
		const tagPaths = new Map<string, Set<string>>();
		const watchedTags = Array.from(
			new Set(ctx.watchedTags.map(normalizeTagName).filter(Boolean)),
		);
		const watchedSet = new Set(watchedTags);

		// Collect tags from metadata (tags frontmatter field and inline tags)
		for (const file of ctx.markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const cache = ctx.metadataCache.getFileCache(file);
			if (!cache) continue;

			const tags = collectTags(cache);
			for (const tag of tags) {
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
				const paths = tagPaths.get(tag) ?? new Set<string>();
				paths.add(file.path);
				tagPaths.set(tag, paths);
			}
		}

		// Report low-usage tags
		for (const [tag, count] of tagCounts) {
			if (count >= ctx.lowUsageTagThreshold) continue;
			if (watchedSet.has(tag)) continue; // watched tags reported separately
			const paths = Array.from(tagPaths.get(tag) ?? []).sort();

			issues.push({
				scannerId: "tag-usage",
				severity: "info",
				title: "Low-usage tag",
				message: `Tag "${tag}" is only used ${count} time(s), below threshold of ${ctx.lowUsageTagThreshold}`,
				primaryPath: paths[0],
				relatedPaths: paths.slice(1),
				evidence: { tag, count, threshold: ctx.lowUsageTagThreshold },
				...describeFinding(
					"confirmed",
					`Tag "${tag}" appears ${count} time${count === 1 ? "" : "s"}, below the configured threshold of ${ctx.lowUsageTagThreshold}.`,
					"Review the tagged notes, then consolidate, keep, or ignore the tag.",
					"Rare tags can be intentional and do not require cleanup.",
				),
				fingerprint: generateFingerprint("tag-usage", undefined, {
					tag,
					lowUsage: true,
				}),
			});
		}

		// Report watched tags that do not appear in the vault
		for (const watchedTag of watchedTags) {
			const count = tagCounts.get(watchedTag) ?? 0;
			if (count > 0) continue;
			issues.push({
				scannerId: "tag-usage",
				severity: "info",
				title: "Missing watched tag",
				message: `Watched tag "${watchedTag}" does not appear in the vault`,
				relatedPaths: [],
				evidence: { tag: watchedTag, count: 0, watched: true },
				...describeFinding(
					"confirmed",
					`Tag "${watchedTag}" is in the configured watchlist but does not appear in the vault.`,
					"Add the tag where expected or remove it from the watchlist.",
					"The tag may have been intentionally retired or renamed.",
				),
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
