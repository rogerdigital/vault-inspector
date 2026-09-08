import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

export type SourceRange = { start: number; end: number };
export type MarkdownSourceLink = SourceRange & {
	kind: "link" | "image";
	original: string;
	destination: string;
};

/** Mask file metadata without shifting UTF-16 offsets or changing line endings. */
function parseBody(content: string) {
	const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	const end = frontmatter?.[0].length ?? (content.startsWith("\uFEFF") ? 1 : 0);
	return fromMarkdown(content.slice(0, end).replace(/[^\r\n]/g, " ") + content.slice(end));
}

function rangeOf(node: Nodes): SourceRange | undefined {
	const start = node.position?.start.offset;
	const end = node.position?.end.offset;
	return start !== undefined && end !== undefined && end > start ? { start, end } : undefined;
}

/** Only ordinary body text is eligible for Obsidian syntax extensions. */
function visit(node: Nodes, onLink: (node: Nodes) => void, onText: (range: SourceRange) => void): void {
	if (node.type === "link" || node.type === "image") {
		onLink(node);
		// Linked images also carry a destination, but labels are not extension text.
		if ("children" in node) for (const child of node.children) visit(child, onLink, () => {});
		return;
	}
	if (["code", "inlineCode", "html", "definition", "linkReference", "imageReference"].includes(node.type)) return;
	if (node.type === "text") {
		const range = rangeOf(node);
		if (range) onText(range);
	}
	if ("children" in node) for (const child of node.children) visit(child, onLink, onText);
}

function escaped(content: string, start: number): boolean {
	let slashes = 0;
	while (start > 0 && content[--start] === "\\") slashes++;
	return slashes % 2 === 1;
}

/** Parse once for consumers that need multiple source-derived metadata fields. */
export function parseMarkdownSource(content: string) {
	const links: MarkdownSourceLink[] = [];
	const ranges: SourceRange[] = [];
	const ids: string[] = [];
	visit(parseBody(content), (node) => {
		if (node.type !== "link" && node.type !== "image") return;
		const range = rangeOf(node);
		if (!range) return;
		const original = content.slice(range.start, range.end);
		// Autolinks and reference syntax are not supported fix kinds.
		if (!original.startsWith(node.type === "image" ? "![" : "[") || !original.endsWith(")")) return;
		links.push({ ...range, kind: node.type, original, destination: node.url });
	}, (range) => {
		const text = content.slice(range.start, range.end);
		for (const match of text.matchAll(/!?\[\[[^[\]\r\n]+\]\]/g)) {
			const start = range.start + match.index;
			if (escaped(content, start) || content[start - 1] === "!") continue;
			ranges.push({ start, end: start + match[0].length });
		}
		for (const match of content.slice(range.start, range.end).matchAll(/\^([A-Za-z0-9-]+)/g)) {
			const start = range.start + match.index;
			if (escaped(content, start)) continue;
			let before = start;
			while (before > 0 && content[before - 1] === "\\") before--;
			if (before > 0 && !/\s/.test(content[before - 1])) continue;
			const end = start + match[0].length;
			const newline = content.indexOf("\n", end);
			if (!/^[\t \r]*$/.test(content.slice(end, newline === -1 ? content.length : newline))) continue;
			ids.push(match[1]);
		}
	});
	return { links, wikiRanges: ranges, blockIds: ids };
}

export function markdownLinks(content: string): MarkdownSourceLink[] {
	return parseMarkdownSource(content).links;
}

export function wikiLinkRanges(content: string): SourceRange[] {
	return parseMarkdownSource(content).wikiRanges;
}

export function blockIds(content: string): string[] {
	return parseMarkdownSource(content).blockIds;
}
