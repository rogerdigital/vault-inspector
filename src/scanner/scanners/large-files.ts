import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isMarkdown } from "../../utils/file-types";
import { isIgnoredPath } from "../../utils/paths";
import { formatSize } from "../../utils/format";

export const largeFilesScanner = {
	id: "large-files" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];

		for (const file of ctx.allFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const isMd = isMarkdown(file.path);
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
