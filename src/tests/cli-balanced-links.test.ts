import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../cli/cli";
import { createLocalApp } from "../../cli/local-vault";

async function withVault(files: Record<string, string>, check: (path: string) => Promise<void>) {
	const path = await mkdtemp(join(tmpdir(), "vi-balanced-"));
	try {
		for (const [name, content] of Object.entries(files)) {
			await mkdir(dirname(join(path, name)), { recursive: true });
			await writeFile(join(path, name), content);
		}
		await check(path);
	} finally {
		await rm(path, { recursive: true, force: true });
	}
}

describe("CLI parsed Markdown links", () => {
	it.each([
		['[label](Note(1).md)', 'Note(1).md'],
		['[label](Note(one(two)).md)', 'Note(one(two)).md'],
		[String.raw`[label](Note\(1\).md)`, 'Note(1).md'],
		['[label](<A note(1).md> "a title")', 'A note(1).md'],
		['[label](Note(1).md "a title")', 'Note(1).md'],
		['[label](Note%281%29.md)', 'Note(1).md'],
		['[label](A&amp;B.md)', 'A&B.md'],
	])("resolves %s and preserves its source", async (original, target) => {
		await withVault({ "Source.md": original, [target]: "# Target" }, async (path) => {
			const app = await createLocalApp(path);
			const source = app.vault.getMarkdownFiles().find((file) => file.path === "Source.md")!;
			expect(app.metadataCache.getFileCache(source)?.links?.[0]).toMatchObject({ original });
			expect(app.metadataCache.resolvedLinks["Source.md"]).toEqual({ [target]: 1 });
			const result = await runCli([path, "--scanner", "broken-links", "--format", "json"]);
			expect(JSON.parse(result.stdout).issues).toEqual([]);
		});
	});

	it("indexes linked images and standalone images for the orphan scanner", async () => {
		await withVault({
			"Source.md": '[![preview](image(1).png)](Note(1).md)\n![another](<another image.png> "title")',
			"Note(1).md": "# Target", "image(1).png": "image", "another image.png": "another", "orphan.png": "orphan",
		}, async (path) => {
			const app = await createLocalApp(path);
			expect(app.metadataCache.resolvedLinks["Source.md"]).toEqual({ "Note(1).md": 1, "image(1).png": 1, "another image.png": 1 });
			const result = await runCli([path, "--scanner", "broken-links,orphan-attachments", "--format", "json"]);
			expect(JSON.parse(result.stdout).issues.map((issue: { primaryPath: string }) => issue.primaryPath)).toEqual(["orphan.png"]);
			const stdout = execFileSync(process.execPath, [
				join(process.cwd(), "cli.js"), path, "--scanner", "broken-links,orphan-attachments",
				"--format", "json", "--fail-on", "none",
			], { encoding: "utf8" });
			expect(JSON.parse(stdout).issues.map((issue: { primaryPath: string }) => issue.primaryPath)).toEqual(["orphan.png"]);
		});
	});

	it("retains a real missing destination and ignores protected Markdown text", async () => {
		const original = '[missing](Missing(1).md "title")';
		await withVault({ "Source.md": [original, '', '    [indented](fake.md)', '', '- ```', '  [list](fake.md)', '  ```', '', '> ```', '> [quote](fake.md)', '> ```', '', '```', '[fence](fake.md)', '```', '', '`[inline](fake.md)`', '', String.raw`\[escaped](fake.md)`, '', '[[Existing|**bold alias**]]'].join('\n'), "Existing.md": "# Target" }, async (path) => {
			const app = await createLocalApp(path);
			const source = app.vault.getMarkdownFiles().find((file) => file.path === "Source.md")!;
			expect(app.metadataCache.getFileCache(source)?.links).toHaveLength(2);
			expect(app.metadataCache.getFileCache(source)?.links).toEqual(expect.arrayContaining([expect.objectContaining({ original, link: "Missing(1).md" })]));
			const result = await runCli([path, "--scanner", "broken-links", "--format", "json"]);
			expect(JSON.parse(result.stdout).issues).toHaveLength(1);
			expect(app.metadataCache.resolvedLinks["Source.md"]).toEqual({ "Existing.md": 1 });
		});
	});
});
