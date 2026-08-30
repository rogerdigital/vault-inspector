import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalApp } from "../../cli/local-vault";
import type { MetadataCache, TFile, Vault } from "obsidian";

type LocalApp = {
	vault: Vault;
	metadataCache: MetadataCache & {
		resolvedLinks: Record<string, Record<string, number>>;
		unresolvedLinks: Record<string, Record<string, number>>;
		getFileCache(file: TFile): {
			links?: { link: string; original?: string }[];
			embeds?: { link: string; original?: string }[];
		} | null;
	};
};

describe("createLocalApp adapter semantics", () => {
	let vaultDir: string;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "vault-inspector-local-"));
	});

	afterEach(async () => {
		await rm(vaultDir, { recursive: true, force: true });
	});

	const buildApp = async () =>
		(await createLocalApp(vaultDir)) as unknown as LocalApp;

	it("never collects dot-prefixed files or directories as vault files", async () => {
		await writeFile(join(vaultDir, "Target.md"), "# Target\n");
		await writeFile(join(vaultDir, ".hidden.cfg"), "config");
		await mkdir(join(vaultDir, ".hiddendir"));
		await writeFile(join(vaultDir, ".hiddendir", "note.md"), "# Hidden\n");

		const { vault } = await buildApp();
		const paths = vault.getFiles().map((file) => file.path);
		expect(paths).toEqual(["Target.md"]);
		expect(vault.getMarkdownFiles().map((file) => file.path)).toEqual(["Target.md"]);
	});

	it("stores alias-stripped targets in link entries while preserving original wiki syntax", async () => {
		await writeFile(
			join(vaultDir, "Source.md"),
			[
				"[[Target]]",
				"[[Target|Alias]]",
				"[[Target#Section]]",
				"![[Target#Section|Embed Alias]]",
				"",
			].join("\n"),
		);
		await writeFile(join(vaultDir, "Target.md"), "# Target\n");

		const { vault, metadataCache } = await buildApp();
		const source = vault.getMarkdownFiles().find((file) => file.path === "Source.md");
		expect(source).toBeDefined();

		expect(metadataCache.unresolvedLinks["Source.md"]).toBeUndefined();
		const resolved = metadataCache.resolvedLinks["Source.md"];
		expect(resolved).toMatchObject({ "Target.md": 4 });

		const cache = metadataCache.getFileCache(source!);
		expect(cache?.links).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ link: "Target", original: "[[Target]]" }),
				expect.objectContaining({ link: "Target", original: "[[Target|Alias]]" }),
				expect.objectContaining({
					link: "Target#Section",
					original: "[[Target#Section]]",
				}),
			]),
		);
		expect(cache?.embeds).toEqual([
			expect.objectContaining({
				link: "Target#Section",
				original: "![[Target#Section|Embed Alias]]",
			}),
		]);
	});

	it("keys unresolvedLinks by the alias-stripped target, merging aliased references", async () => {
		await writeFile(
			join(vaultDir, "Source.md"),
			["[[Missing Note]]", "[[Missing Note|Alias]]", ""].join("\n"),
		);

		const { metadataCache } = await buildApp();
		const unresolved = metadataCache.unresolvedLinks["Source.md"];
		expect(Object.keys(unresolved ?? {})).toEqual(["Missing Note"]);
		expect(unresolved?.["Missing Note"]).toBe(2);
	});

	it("resolves links case-insensitively, including getFirstLinkpathDest", async () => {
		await writeFile(join(vaultDir, "Target.md"), "# Target\n");
		await writeFile(join(vaultDir, "Source.md"), "[[target]]\n[label](target.md)\n");

		const { vault, metadataCache } = await buildApp();
		expect(metadataCache.unresolvedLinks["Source.md"]).toBeUndefined();
		expect(metadataCache.resolvedLinks["Source.md"]).toMatchObject({
			"Target.md": 2,
		});

		const target = vault.getMarkdownFiles().find((file) => file.path === "Target.md");
		const dest = metadataCache.getFirstLinkpathDest("target", "Source.md");
		expect(dest?.path).toBe("Target.md");
		expect(dest?.path).toBe(target?.path);
	});
});
