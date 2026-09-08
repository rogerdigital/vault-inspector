import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../../cli/cli";
import { createLocalApp } from "../../cli/local-vault";
import { generateFingerprint } from "../scanner/issue-fingerprint";
import { buildReferenceIndex } from "../scanner/reference-index";

async function withVault(files: Record<string, string>, check: (path: string) => Promise<void>) {
	const path = await mkdtemp(join(tmpdir(), "vi-encoded-"));
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

async function scan(path: string) {
	const result = await runCli([path, "--scanner", "broken-links", "--format", "json", "--fail-on", "none"]);
	expect(result.stderr).toBe("");
	expect(result.exitCode).toBe(0);
	return JSON.parse(result.stdout);
}

describe("CLI encoded Markdown destinations", () => {
	it.each([
		["My%20Note.md", "My Note.md"],
		["%E4%B8%AD%E6%96%87.md", "中文.md"],
		["./My%20Note.md", "nested/My Note.md"],
		["../My%20Note.md", "My Note.md"],
		["<My%20Note.md>", "My Note.md"],
		["Name%23part.md#A%20heading", "Name#part.md"],
		["Name%23part.md", "Name#part.md"],
		["Rate%25.md", "Rate%.md"],
		["My%2520Note.md", "My%20Note.md"],
		["invalid%.md", "invalid%.md"],
		["Pipe%7Cname.md", "Pipe|name.md"],
		["Pipe|name.md", "Pipe|name.md"],
	])("resolves %s exactly once", async (destination, target) => {
		await withVault({ "nested/Source.md": `[label](${destination})`, [target]: "# A heading\n" }, async (path) => {
			expect((await scan(path)).issues).toEqual([]);
		});
	});

	it.each([ [true, true], [true, false], [false, true], [false, false] ])(
		"keeps Markdown and Wiki destinations independent (space=%s literal=%s)", async (space, literal) => {
			await withVault({
				"Source.md": "[label](My%20Note.md)\n[[My%20Note.md]]",
				...(space ? { "My Note.md": "# Space" } : {}),
				...(literal ? { "My%20Note.md": "# Literal" } : {}),
			}, async (path) => {
				const payload = await scan(path);
				expect(payload.schemaVersion).toBe(1);
				expect(payload.issues).toHaveLength(Number(!space) + Number(!literal));
				expect(payload.issues.map((issue: { evidence: { target: string } }) => issue.evidence.target).sort())
					.toEqual([...(space ? [] : ["My Note.md"]), ...(literal ? [] : ["My%20Note.md"])].sort());
				for (const issue of payload.issues) {
					expect(issue.evidence.link).toBe("My%20Note.md");
					expect(issue.fingerprint).toBe(generateFingerprint("broken-links", "Source.md", {
						link: "My%20Note.md", target: issue.evidence.target,
					}));
					expect(issue.fixAction.original).toBe(issue.evidence.target === "My Note.md" ? "[label](My%20Note.md)" : "[[My%20Note.md]]");
					expect(issue).not.toHaveProperty("destination");
					expect(issue.evidence).not.toHaveProperty("resolvedPath");
				}
				const app = await createLocalApp(path);
				const allFiles = app.vault.getFiles();
				const index = await buildReferenceIndex({ ...app, markdownFiles: app.vault.getMarkdownFiles(), allFiles,
					filePathIndex: new Set(allFiles.map((file) => file.path)),
				});
				expect(index.inboundByPath.get("My Note.md")?.count ?? 0).toBe(Number(space));
				expect(index.inboundByPath.get("My%20Note.md")?.count ?? 0).toBe(Number(literal));
			});
		},
	);

	it("indexes encoded attachments, literal-hash notes, blocks and frontmatter with correct kinds", async () => {
		await withVault({
			"Source.md": '---\nref: "[[Target#^known]]"\n---\n![page](My%20file.pdf#page=2)\n[hash](Hash%23name.md#Heading)\n[[Target#^known]]',
			"My file.pdf": "pdf", "Hash#name.md": "# Heading", "Target.md": "Body ^known",
		}, async (path) => {
			const app = await createLocalApp(path);
			const allFiles = app.vault.getFiles();
			const index = await buildReferenceIndex({ ...app, allFiles, markdownFiles: app.vault.getMarkdownFiles(),
				filePathIndex: new Set(allFiles.map((file) => file.path)),
			});
			expect(index.inboundByPath.get("My file.pdf")).toMatchObject({ count: 1, kinds: ["embed"] });
			expect(index.inboundByPath.get("Hash#name.md")).toMatchObject({ count: 1, kinds: ["note-link"] });
			expect(index.inboundByPath.get("Target.md")).toMatchObject({ count: 2, kinds: ["frontmatter", "note-link"] });
			const result = await runCli([path, "--scanner", "orphan-attachments", "--format", "json", "--fail-on", "none"]);
			expect(JSON.parse(result.stdout).issues).toEqual([]);
		});
	});

	it("does not inspect note metadata for an extensionless non-Markdown target", async () => {
		await withVault({ "Source.md": "[license](LICENSE#Heading)", LICENSE: "License text" }, async (path) => {
			const payload = await scan(path);
			expect(payload.issues).toHaveLength(1);
			expect(payload.issues[0].message).toBe("Linked file not found: LICENSE");
		});
	});

	it("checks decoded fragments without changing original syntax or literal hash paths", async () => {
		await withVault({
			"Source.md": "[jump](Hash%23name.md#Missing%20heading)\n[block](Hash%23name.md#%5Eknown)",
			"Hash#name.md": "Body ^known",
		}, async (path) => {
			const payload = await scan(path);
			expect(payload.issues).toHaveLength(1);
			expect(payload.issues[0]).toMatchObject({
				message: 'Heading "#Missing heading" not found in Hash#name.md',
				evidence: { link: "Hash%23name.md#Missing%20heading", target: "Hash#name.md" },
				fixAction: { original: "[jump](Hash%23name.md#Missing%20heading)" },
			});
		});
	});

	it("distinguishes decoded heading fingerprints when comparing a literal Wiki baseline", async () => {
		await withVault({ "Source.md": "[[#Missing%20heading]]" }, async (path) => {
			const baseline = await scan(path);
			const baselinePath = join(path, "baseline.json");
			await writeFile(baselinePath, JSON.stringify(baseline));
			await writeFile(join(path, "Source.md"), "[jump](#Missing%20heading)\n[[#Missing%20heading]]");
			const payload = await scan(path);
			expect(payload.issues).toHaveLength(2);
			expect(new Set(payload.issues.map((issue: { fingerprint: string }) => issue.fingerprint)).size).toBe(2);
			expect(payload.comparison.fingerprints).toHaveLength(2);
			const wiki = payload.issues.find((issue: { fixAction: { original: string } }) => issue.fixAction.original.startsWith("[["));
			expect(wiki.fingerprint).toBe(generateFingerprint("broken-links", "Source.md", {
				link: "#Missing%20heading", target: "Source.md",
			}));
			const compared = await runCli([path, "--scanner", "broken-links", "--format", "json", "--baseline", baselinePath, "--fail-on", "new"]);
			expect(compared.exitCode).toBe(1);
			expect(compared.stderr).toBe("");
			const result = JSON.parse(compared.stdout);
			expect(result.comparison).toMatchObject({ newIssues: 1, persistingIssues: 1, resolvedIssues: 0 });
			expect(result.issues.find((issue: { isNew: boolean }) => issue.isNew).fixAction.original).toBe("[jump](#Missing%20heading)");
		});
	});

	it.each(["Missing", "invalid%"])("retains existing fingerprints for unchanged fragment %s", async (fragment) => {
		await withVault({ "Source.md": `[jump](#${fragment})` }, async (path) => {
			const payload = await scan(path);
			expect(payload.issues[0].fingerprint).toBe(generateFingerprint("broken-links", "Source.md", {
				link: `#${fragment}`, target: "Source.md",
			}));
		});
	});

	it("keeps getFirstLinkpathDest a pure literal-path resolver", async () => {
		await withVault({ "My Note.md": "", "My%20Note.md": "", "Hash#name.md": "", "Pipe|name.md": "" }, async (path) => {
			const { metadataCache } = await createLocalApp(path);
			for (const target of ["My Note.md", "My%20Note.md", "Hash#name.md", "Pipe|name.md"]) {
				expect(metadataCache.getFirstLinkpathDest(target, "Source.md")?.path).toBe(target);
			}
		});
	});
});
