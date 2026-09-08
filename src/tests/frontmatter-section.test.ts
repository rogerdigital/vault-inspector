import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "../utils/frontmatter-section";

describe("frontmatter section boundaries", () => {
	it.each([
		["---\n---\n", ""],
		["\uFEFF---\r\n---\r\n", ""],
		["---\nkey: value\n---\n", "key: value\n"],
		["\uFEFF---\r\nkey: value\r\n---\r\n", "key: value\r\n"],
	])("preserves every body character after %j", (header, frontmatter) => {
		const body = "\r\n[link](missing.md)\r\n\r\n---\r\n\r\nTail\r\n";
		expect(splitFrontmatter(header + body)).toEqual({ frontmatter, body, bodyStart: header.length });
	});

	it.each(["---\n---", "\uFEFF---\r\n---"])("accepts a closing delimiter at EOF: %j", (content) => {
		expect(splitFrontmatter(content)).toEqual({ frontmatter: "", body: "", bodyStart: content.length });
	});

	it.each(["Body", "\uFEFFBody", "---\nkey: value", "\uFEFF---\r\nkey: value", "---\nkey: value\n--- \nBody"])("preserves absent or unclosed frontmatter: %j", (content) => {
		expect(splitFrontmatter(content)).toEqual({ body: content, bodyStart: 0 });
	});
});
