import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

const readDoc = (relativePath: string): Promise<string> =>
	readFile(path.join(root, relativePath), "utf8");

describe("documentation product boundary", () => {
	it("keeps the Obsidian workflow before optional automation", async () => {
		const readme = await readDoc("README.md");
		expect(readme).toContain("## Use in Obsidian");
		expect(readme).toContain("## Optional CLI automation");
		expect(readme.indexOf("## Use in Obsidian"))
			.toBeLessThan(readme.indexOf("## Optional CLI automation"));
		expect(readme).toContain("[CLI reference](docs/cli.md)");
	});

	it("keeps automation contracts in the dedicated CLI reference", async () => {
		const cli = await readDoc("docs/cli.md");
		for (const required of [
			"## Installation",
			"## Configuration",
			"## JSON protocol",
			"## Baseline comparison",
			"## Exit codes",
			"comparison.fingerprints",
			"ignoredFoldersByScanner",
			"--fail-on",
		]) {
			expect(cli).toContain(required);
		}
	});

	it("states the mutation boundary in both plugin and CLI docs", async () => {
		const readme = await readDoc("README.md");
		const cli = await readDoc("docs/cli.md");
		expect(readme).toContain("Fixes run only after explicit confirmation");
		expect(cli).toContain("CLI scan mode is read-only");
	});
});
