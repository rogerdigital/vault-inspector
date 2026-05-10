import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isMarkdown } from "../../utils/file-types";

export const largeFilesScanner = {
	id: "large-files" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];

		for (const file of ctx.allFiles) {
			if (isIgnored(file.path, ctx.ignoredFolders)) continue;

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

		// Sort largest first
		issues.sort((a, b) => (b.evidence.size as number) - (a.evidence.size as number));

		return issues;
	},
};

function isIgnored(path: string, ignoredFolders: string[]): boolean {
	for (const folder of ignoredFolders) {
		if (path.startsWith(folder + "/") || path === folder) return true;
	}
	return false;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
