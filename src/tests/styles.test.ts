import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("styles.css", () => {
	it("avoids gap properties that trigger Obsidian compatibility warnings", async () => {
		const css = await readFile("styles.css", "utf8");

		expect(css).not.toMatch(/\b(?:row-|column-)?gap\s*:/);
	});
});
