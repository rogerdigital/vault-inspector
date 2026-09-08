/** Locate the first complete frontmatter section without interpreting its YAML. */
export function splitFrontmatter(content: string): { frontmatter?: string; body: string; bodyStart: number } {
	const opening = /^\uFEFF?---\r?\n/.exec(content);
	if (opening) {
		const rest = content.slice(opening[0].length);
		const closing = /(?:^|\n)---(?:\r?\n|$)/.exec(rest);
		if (closing) {
			const bodyStart = opening[0].length + closing.index + closing[0].length;
			const yamlEnd = closing.index + (closing[0].startsWith("\n") ? 1 : 0);
			return { frontmatter: rest.slice(0, yamlEnd), body: content.slice(bodyStart), bodyStart };
		}
	}
	return { body: content, bodyStart: 0 };
}
