import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";
import { getInboundReference } from "../reference-index";

export const emptyNotesScanner = {
	id: "empty-notes" as const,

	async scan(ctx: ScanContext): Promise<Issue[]> {
		const issues: Issue[] = [];
		const index = ctx.referenceIndex;

		for (const file of ctx.markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const content = await ctx.vault.cachedRead(file);
			const body = stripFrontmatterAndTitle(content);
			const wordCount = countWords(body);
			const structureCount = countMeaningfulStructures(body);
			const inboundReferenceCount =
				getInboundReference(index, file.path)?.count ?? 0;

			if (wordCount <= ctx.emptyNoteWordThreshold && structureCount === 0) {
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
					evidence: {
						size: file.stat.size,
						wordCount,
						structureCount,
						inboundReferenceCount,
					},
					...describeFinding(
						"candidate",
						`The note contains ${wordCount} meaningful word${wordCount === 1 ? "" : "s"} and no meaningful structures (links, embeds, tasks, list items, or code blocks), at or below the configured threshold of ${ctx.emptyNoteWordThreshold}.`,
						inboundReferenceCount > 0
							? `This stub is referenced by ${inboundReferenceCount} inbound link${inboundReferenceCount === 1 ? "" : "s"}. Review why it is referenced before adding content or deleting it.`
							: "Add meaningful content, ignore the finding, or move the note to trash after review.",
						"Intentional placeholders, index notes, and generated stubs can be valid.",
					),
					fingerprint: generateFingerprint("empty-notes", file.path, {}),
					// Delete eligibility requires zero inbound references: a
					// referenced stub may be a deliberate index entry, so it
					// stays reviewable and out of bulk-delete flows.
					...(inboundReferenceCount === 0
						? {
								fixAction: {
									kind: "trash-file" as const,
									label: "Delete",
									description: `Move "${file.path}" to trash`,
									targetPaths: [file.path],
								},
							}
						: {}),
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

/**
 * Count meaningful structures in a note body (after frontmatter and title
 * removal), independently from the prose word count:
 *
 * - internal links and embeds (every `[[...]]` occurrence);
 * - Markdown task items (`- [ ]` / `- [x]`, bullet or ordered);
 * - non-empty list items (bullet or ordered);
 * - fenced code blocks with at least one non-blank inner line (once per
 *   block; an unterminated fence counts nothing — its text is already
 *   measured by countWords);
 * - other non-prose visible blocks: table blocks (once per run of `|` rows),
 *   Markdown images, and `<img>` lines.
 *
 * Plain prose paragraphs deliberately count ZERO structures: countWords
 * already measures them, so counting them would make every prose stub
 * "structural" and defeat stub detection entirely. structureCount is a count
 * of meaning indicators (a link inside a list item is visible in both
 * categories), and only `=== 0` gates empty-note reporting.
 */
export function countMeaningfulStructures(body: string): number {
	let count = 0;
	// Internal links and embeds, wherever they appear.
	for (const match of body.matchAll(/\[\[[^\]]+\]\]/g)) {
		void match;
		count++;
	}

	let inFence = false;
	let fenceHasContent = false;
	let inTable = false;
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (/^(```|~~~)/.test(trimmed)) {
			if (inFence && fenceHasContent) count++;
			inFence = !inFence;
			fenceHasContent = false;
			continue;
		}
		if (inFence) {
			if (trimmed !== "") fenceHasContent = true;
			continue;
		}
		if (trimmed === "") continue;
		if (/^\|.*\|/.test(trimmed)) {
			if (!inTable) {
				count++;
				inTable = true;
			}
			continue;
		}
		inTable = false;
		if (/^[-*+]\s+\[[ xX]\]/.test(trimmed)) {
			count++;
			continue;
		}
		if (/^\d+[.)]\s+\[[ xX]\]/.test(trimmed)) {
			count++;
			continue;
		}
		if (/^[-*+]\s+\S/.test(trimmed)) {
			count++;
			continue;
		}
		if (/^\d+[.)]\s+\S/.test(trimmed)) {
			count++;
			continue;
		}
		if (/^!\[[^\]]*\]\([^)]*\)/.test(trimmed) || /<img\b/.test(trimmed)) {
			count++;
		}
		// Plain prose line: not a structure — countWords covers it.
	}
	return count;
}
