import { describe, expect, it } from "vitest";
import { blockIds, markdownLinks, wikiLinkRanges } from "../utils/markdown-source";

describe("Markdown source ranges", () => {
	it("returns complete balanced links and images with exact offsets", () => {
		const content = '\uFEFF---\r\nref: "[hidden](x)"\r\n---\r\n[x](Note(1).md "title") ![a](<a b.png>) [e](a\\(b\\).md)';
		const links = markdownLinks(content);
		expect(links.map(({ destination }) => destination)).toEqual(["Note(1).md", "a b.png", "a(b).md"]);
		expect(links.map(({ kind }) => kind)).toEqual(["link", "image", "link"]);
		for (const link of links) expect(content.slice(link.start, link.end)).toBe(link.original);
		expect(links[0].start).toBe(content.indexOf("[x]"));
	});

	it("excludes references, code, escaped links and HTML", () => {
		const content = '[ref][id]\n\n[id]: dest\n\n    [x](x)\n\n`[x](x)`\n\n\\[x](x)\n\n<!-- [x](x) -->\n\n```\n[x](x)\n```';
		expect(markdownLinks(content)).toEqual([]);
	});

	it("recognizes plain Wiki text, aliases, embeds and even escapes only", () => {
		const content = String.raw`[[One]] ![[Two|Alias]] \[[Odd]] \\[[Even]] \\\[[Odd3]] \![[NoEmbed]] [[Split|**bold**]] [label](<[[destination]]>) [with [[nested]]](target)`;
		expect(wikiLinkRanges(content).map(({ start, end }) => content.slice(start, end)))
			.toEqual(["[[One]]", "![[Two|Alias]]", "[[Even]]"]);
	});

	it("extracts only unescaped body block markers at the physical line end", () => {
		const content = '\uFEFF---\r\nkey: value ^yaml\r\n---\r\nBody ^valid-block\r\n\r\n^standalone\n\n- item ^list\n\n> quote ^quote\n\n    code ^code\n\n`inline ^inline`\n\n<!-- ^comment -->\n\nBody ^middle text\n\nBody \\^escaped\n\nBody \\\\^even\n\n[x ^label](dest)\n\nBody ^end  \n\n```\nBody ^fenced\n```';
		expect(blockIds(content)).toEqual(["valid-block", "standalone", "list", "quote", "even", "end"]);
	});

	it("preserves offsets with a BOM but without frontmatter", () => {
		const content = '\uFEFF[[Wiki]] [link](x)';
		expect(wikiLinkRanges(content)).toEqual([{ start: 1, end: 9 }]);
		expect(markdownLinks(content)[0].start).toBe(10);
	});
});

it("includes both destinations of a linked image without treating its label as Wiki text", () => {
	const content = '[![[[literal]]](image.png)](target.md)';
	expect(markdownLinks(content).map(({ destination }) => destination)).toEqual(["target.md", "image.png"]);
	expect(wikiLinkRanges(content)).toEqual([]);
});
