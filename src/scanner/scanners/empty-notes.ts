import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
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
			const wordCount = countWords(body);

			if (wordCount <= ctx.emptyNoteWordThreshold) {
				issues.push({
					scannerId: "empty-notes",
					severity: "warning",
					title: "Empty note",
					message:
						wordCount === 0
							? "This note has no content besides a title"
							: `This note only has ${wordCount} word${wordCount > 1 ? "s" : ""} (likely a stub)`,
					primaryPath: file.path,
					relatedPaths: [],
					evidence: { size: file.stat.size, wordCount },
					...describeFinding(
						"candidate",
						`The note contains ${wordCount} meaningful word${wordCount === 1 ? "" : "s"}, at or below the configured threshold of ${ctx.emptyNoteWordThreshold}.`,
						"Add meaningful content, ignore the finding, or move the note to trash after review.",
						"Intentional placeholders, index notes, and generated stubs can be valid.",
					),
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

/**
 * Count words in note body with CJK awareness.
 *
 * CJK characters (Han, Hiragana, Katakana, Hangul) each count as one word,
 * since CJK text has no word separators. Latin/other scripts are split on
 * whitespace into words. Mixed content is summed correctly.
 *
 * Example: "hello world 世界" = 1 (hello) + 1 (world) + 2 (世, 界) = 4 words.
 */
export function countWords(text: string): number {
	let count = 0;
	// Matches a run of CJK ideographs/syllables — each char is its own "word".
	const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
	for (const match of text.matchAll(cjkPattern)) {
		void match;
		count++;
	}
	// Remove CJK chars, then count whitespace-separated words in what remains.
	const withoutCjk = text.replace(cjkPattern, " ");
	for (const segment of withoutCjk.split(/\s+/)) {
		if (segment.length > 0) count++;
	}
	return count;
}
