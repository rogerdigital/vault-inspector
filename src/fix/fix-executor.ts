import { App, TFile } from "obsidian";
import type { FixAction } from "../scanner/Issue";

export async function executeFixAction(app: App, action: FixAction): Promise<number> {
	switch (action.kind) {
		case "trash-file":
			return trashFiles(app, action.targetPaths);
		case "remove-link-text": {
			const source = action.targetPaths[0];
			if (action.original !== undefined) {
				return replaceLinkText(app, source, action.original, action.replacement ?? "");
			}
			return removeLinkText(app, source, action.linkText!);
		}
		default:
			return 0;
	}
}

async function trashFiles(app: App, paths: string[]): Promise<number> {
	let count = 0;
	for (const path of paths) {
		const file = app.vault.getAbstractFileByPath(path);
		if (file) {
			await app.fileManager.trashFile(file);
			count++;
		}
	}
	return count;
}

async function removeLinkText(app: App, sourcePath: string, linkText: string): Promise<number> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) return 0;

	const content = await app.vault.read(file);
	const pattern = new RegExp(`!?\\[\\[${escapeRegex(linkText)}\\]\\]`, "g");
	const protectedRanges = findProtectedMarkdownRanges(content);
	let cursor = 0;
	let updated = "";
	let removed = false;

	for (const match of content.matchAll(pattern)) {
		const start = match.index;
		const end = start + match[0].length;
		if (protectedRanges.some((range) => start < range.end && end > range.start)) {
			continue;
		}
		updated += content.slice(cursor, start);
		cursor = end;
		removed = true;
	}
	if (removed) updated += content.slice(cursor);
	else updated = content;
	if (updated === content) return 0;

	await app.vault.modify(file, updated);
	return 1;
}

/**
 * Replace every unprotected occurrence of the literal `original` syntax with
 * `replacement` ("" removes the range). Preferred over the legacy wiki
 * pattern when the fix action carries exact source metadata.
 */
async function replaceLinkText(
	app: App,
	sourcePath: string,
	original: string,
	replacement: string,
): Promise<number> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) return 0;

	const content = await app.vault.read(file);
	// Negative lookbehind: a wiki original "[[x]]" is a substring of the embed
	// "![[x]]" (and a markdown original of its image form "![](x)"). Non-embed
	// actions must never consume an embed occurrence; embed actions carry the
	// "!" in their original and match exactly.
	const pattern = new RegExp(`(?<!!)${escapeRegex(original)}`, "g");
	const protectedRanges = findProtectedMarkdownRanges(content);
	let cursor = 0;
	let updated = "";
	let replaced = false;

	for (const match of content.matchAll(pattern)) {
		const start = match.index;
		const end = start + match[0].length;
		if (protectedRanges.some((range) => start < range.end && end > range.start)) {
			continue;
		}
		updated += content.slice(cursor, start) + replacement;
		cursor = end;
		replaced = true;
	}
	if (replaced) updated += content.slice(cursor);
	else updated = content;
	if (updated === content) return 0;

	await app.vault.modify(file, updated);
	return 1;
}

type TextRange = {
	start: number;
	end: number;
};

function findProtectedMarkdownRanges(content: string): TextRange[] {
	const ranges = [
		...findFencedCodeRanges(content),
		...findHtmlCommentRanges(content),
	];
	ranges.push(...findInlineCodeRanges(content, ranges));
	return mergeRanges(ranges);
}

function findFencedCodeRanges(content: string): TextRange[] {
	const ranges: TextRange[] = [];
	let lineStart = 0;
	let fence: { char: "`" | "~"; length: number; start: number } | null = null;

	while (lineStart < content.length) {
		const newline = content.indexOf("\n", lineStart);
		const lineEnd = newline === -1 ? content.length : newline + 1;
		const line = content.slice(lineStart, newline === -1 ? content.length : newline);

		if (fence) {
			const closingFence = new RegExp(
				`^ {0,3}${escapeRegex(fence.char)}{${fence.length},}[\\t ]*$`,
			);
			if (closingFence.test(line)) {
				ranges.push({ start: fence.start, end: lineEnd });
				fence = null;
			}
		} else {
			const openingFence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
			if (
				openingFence
				&& (openingFence[1][0] === "~" || !openingFence[2].includes("`"))
			) {
				fence = {
					char: openingFence[1][0] as "`" | "~",
					length: openingFence[1].length,
					start: lineStart,
				};
			}
		}
		lineStart = lineEnd;
	}

	if (fence) ranges.push({ start: fence.start, end: content.length });
	return ranges;
}

function findHtmlCommentRanges(content: string): TextRange[] {
	const ranges: TextRange[] = [];
	let searchFrom = 0;

	while (searchFrom < content.length) {
		const start = content.indexOf("<!--", searchFrom);
		if (start === -1) break;
		const closing = content.indexOf("-->", start + 4);
		const end = closing === -1 ? content.length : closing + 3;
		ranges.push({ start, end });
		searchFrom = end;
	}
	return ranges;
}

function findInlineCodeRanges(content: string, excludedRanges: TextRange[]): TextRange[] {
	const ranges: TextRange[] = [];
	let index = 0;

	while (index < content.length) {
		if (content[index] !== "`" || containsIndex(excludedRanges, index)) {
			index++;
			continue;
		}

		const start = index;
		while (content[index] === "`") index++;
		const marker = content.slice(start, index);
		let closing = content.indexOf(marker, index);
		while (
			closing !== -1
				&& (
					content[closing - 1] === "`"
					|| content[closing + marker.length] === "`"
					|| containsIndex(excludedRanges, closing)
				)
		) {
			closing = content.indexOf(marker, closing + marker.length);
		}
		if (closing === -1) continue;

		const end = closing + marker.length;
		ranges.push({ start, end });
		index = end;
	}
	return ranges;
}

function containsIndex(ranges: TextRange[], index: number): boolean {
	return ranges.some((range) => index >= range.start && index < range.end);
}

function mergeRanges(ranges: TextRange[]): TextRange[] {
	const sorted = [...ranges].sort((left, right) => left.start - right.start);
	const merged: TextRange[] = [];

	for (const range of sorted) {
		const previous = merged[merged.length - 1];
		if (previous && range.start <= previous.end) {
			previous.end = Math.max(previous.end, range.end);
		} else {
			merged.push({ ...range });
		}
	}
	return merged;
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
