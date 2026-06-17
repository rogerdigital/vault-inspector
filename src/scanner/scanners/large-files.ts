import type { TFile } from "obsidian";
import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isMarkdown } from "../../utils/file-types";
import { isIgnoredPath, matchesGlob } from "../../utils/paths";
import { formatSize } from "../../utils/format";

export const largeFilesScanner = {
	id: "large-files" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];

		for (const file of ctx.allFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const isMd = isMarkdown(file.path);
			if (isMd && isIgnoredLargeMarkdown(file, ctx)) continue;

			const threshold = isMd
				? ctx.largeMarkdownBytes
				: ctx.largeAttachmentBytes;

			if (file.stat.size > threshold) {
				issues.push({
					scannerId: "large-files",
					severity: "warning",
					title: "Large file",
					message: `File is ${formatSize(file.stat.size)}, exceeds ${formatSize(threshold)} threshold`,
					primaryPath: file.path,
					relatedPaths: [],
					evidence: {
						size: file.stat.size,
						threshold,
						type: isMd ? "markdown" : "attachment",
					},
					fingerprint: generateFingerprint("large-files", file.path, {
						size: file.stat.size,
					}),
				});
			}
		}

		issues.sort((a, b) => (b.evidence.size as number) - (a.evidence.size as number));

		return issues;
	},
};

function isIgnoredLargeMarkdown(file: TFile, ctx: ScanContext): boolean {
	if (
		ctx.ignoredLargeMarkdownPathPatterns.some((pattern) =>
			matchesGlob(file.path, pattern),
		)
	) {
		return true;
	}

	if (ctx.ignoredLargeMarkdownFrontmatterKeys.length === 0) return false;
	if (typeof ctx.metadataCache.getFileCache !== "function") return false;

	const frontmatter = ctx.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter) return false;

	return ctx.ignoredLargeMarkdownFrontmatterKeys.some((key) =>
		Object.prototype.hasOwnProperty.call(frontmatter, key),
	);
}
