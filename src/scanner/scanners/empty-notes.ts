import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";

export const emptyNotesScanner = {
	id: "empty-notes" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];

		for (const file of ctx.markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const content = await ctx.vault.cachedRead(file);
			const bodyText = stripFrontmatter(content);
			const wordCount = countWords(bodyText);

			if (wordCount <= ctx.emptyNoteWordThreshold) {
				const isEmpty = wordCount === 0;
				issues.push({
					scannerId: "empty-notes",
					severity: isEmpty ? "warning" : "info",
					title: isEmpty ? "Empty note" : "Stub note",
					message: isEmpty
						? "This note has no content (or only frontmatter)"
						: `This note has only ${wordCount} word(s)`,
					primaryPath: file.path,
					relatedPaths: [],
					evidence: {
						wordCount,
						size: file.stat.size,
					},
					fingerprint: generateFingerprint("empty-notes", file.path, {
						empty: isEmpty,
					}),
					fixAction: {
						kind: "trash-file",
						label: "Delete",
						description: `Move "${file.path}" to trash`,
						targetPaths: [file.path],
					},
				});
			}
		}

		return issues;
	},
};

function stripFrontmatter(content: string): string {
	if (content.startsWith("---")) {
		const end = content.indexOf("\n---", 3);
		if (end !== -1) {
			return content.slice(end + 4);
		}
	}
	return content;
}

function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	return trimmed.split(/\s+/).length;
}
