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
			const body = stripFrontmatterAndTitle(content);

			if (body.trim().length === 0) {
				issues.push({
					scannerId: "empty-notes",
					severity: "warning",
					title: "Empty note",
					message: "This note has no content besides a title",
					primaryPath: file.path,
					relatedPaths: [],
					evidence: { size: file.stat.size },
					fingerprint: generateFingerprint("empty-notes", file.path, {}),
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

function stripFrontmatterAndTitle(content: string): string {
	let text = content;
	if (text.startsWith("---")) {
		const end = text.indexOf("\n---", 3);
		if (end !== -1) {
			text = text.slice(end + 4);
		}
	}
	text = text.replace(/^#+\s+.*$/m, "");
	return text;
}
