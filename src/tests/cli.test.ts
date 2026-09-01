import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../../cli/cli";
import { createLocalApp } from "../../cli/local-vault";
import { EXTERNAL_LINK_TIMEOUT_MS } from "../scanner/scanners/external-links";

async function withVault(
	files: Record<string, string>,
	fn: (vaultPath: string) => Promise<void>,
): Promise<void> {
	const vaultPath = await mkdtemp(join(tmpdir(), "vault-inspector-"));
	try {
		for (const [path, content] of Object.entries(files)) {
			await mkdir(dirname(join(vaultPath, path)), { recursive: true });
			await writeFile(join(vaultPath, path), content, "utf8");
		}
		await fn(vaultPath);
	} finally {
		await rm(vaultPath, { recursive: true, force: true });
	}
}

describe("runCli", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("shows the short command alias in usage output", async () => {
		const result = await runCli([]);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("vinspect <vault-path>");
		expect(result.stderr).toContain("vault-inspector <vault-path>");
	});

	it("prints help to stdout with a successful exit code", async () => {
		const result = await runCli(["--help"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("vinspect <vault-path>");
		expect(result.stdout).toContain("vault-inspector <vault-path>");
		expect(result.stdout).toContain("--ignore-unresolved-note-links");
		expect(result.stdout).toContain("Ignore missing plain note wikilinks");
		expect(result.stderr).toBe("");
	});

	it("prints machine-readable JSON scan results", async () => {
		await withVault({ "empty.md": "# Empty\n" }, async (vaultPath) => {
			const result = await runCli(["scan", vaultPath, "--format", "json"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe("");

			const payload = JSON.parse(result.stdout);
			expect(payload).toMatchObject({
				schemaVersion: 1,
				toolVersion: expect.any(String),
				summary: expect.objectContaining({
					issues: expect.any(Number),
					newIssues: expect.any(Number),
				}),
			});
			expect(payload.tool).toBe("vault-inspector");
			expect(payload.toolVersion).toMatch(/^\d+\.\d+\.\d+/);
			expect(payload.vaultPath).toBe(vaultPath);
			expect(payload.summary.filesScanned).toBe(1);
			expect(payload.summary.issues).toBe(1);
			expect(payload.summary.warnings).toBe(1);
			expect(payload.issues).toEqual([
				expect.objectContaining({
					scannerId: "empty-notes",
					severity: "warning",
					primaryPath: "empty.md",
					relatedPaths: expect.any(Array),
					evidence: expect.any(Object),
					fingerprint: expect.any(String),
					classification: expect.stringMatching(/^(confirmed|candidate|unverified)$/),
					explanation: expect.objectContaining({
						why: expect.any(String),
						nextStep: expect.any(String),
					}),
				}),
			]);
			expect(payload.comparison).toEqual({
				available: false,
				mode: "none",
				reason: "missing-baseline",
				newIssues: 0,
				persistingIssues: 0,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			expect(payload).not.toHaveProperty("resolvedIssues");
		});
	});

	it("keeps external link checks disabled in default CLI scans", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			status: 404,
		} as Response);

		await withVault(
			{
				"note.md": "https://example.com/dead\n\nEnough content to avoid empty note warnings.\n",
			},
			async (vaultPath) => {
				const result = await runCli(["scan", vaultPath]);
				const payload = JSON.parse(result.stdout);

				expect(fetchMock).not.toHaveBeenCalled();
				expect(payload.summary.scannersRun).not.toContain("external-links");
			},
		);
	});

	it("writes scan progress to stderr when requested", async () => {
		await withVault({ "empty.md": "# Empty\n" }, async (vaultPath) => {
			const result = await runCli(["scan", vaultPath, "--format", "json", "--progress"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Scanning vault...");
			expect(result.stderr).toContain("[1/8] Broken Links");
			expect(result.stderr).toContain("External Links skipped (disabled)");
			expect(result.stderr).toContain("Done in ");

			const payload = JSON.parse(result.stdout);
			expect(payload.tool).toBe("vault-inspector");
		});
	});

	it("can stream scan progress through a runtime stderr writer", async () => {
		await withVault({ "empty.md": "# Empty\n" }, async (vaultPath) => {
			let streamed = "";
			const result = await runCli(["scan", vaultPath, "--progress"], {
				writeStderr: (text) => {
					streamed += text;
				},
			});

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe("");
			expect(streamed).toContain("Scanning vault...");
			expect(streamed).toContain("[1/8] Broken Links");
			expect(JSON.parse(result.stdout).tool).toBe("vault-inspector");
		});
	});

	it("treats a vault path as the default scan command", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const result = await runCli([vaultPath, "--scanner", "empty-notes"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe("");
			const payload = JSON.parse(result.stdout);
			expect(payload.vaultPath).toBe(vaultPath);
			expect(payload.summary.scannersRun).toEqual(["empty-notes"]);
			expect(payload.issues[0].primaryPath).toBe("empty.md");
		});
	});

	it("writes markdown output when an output path is provided", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const outputPath = join(vaultPath, "report.md");
			const result = await runCli([
				"scan",
				vaultPath,
				"--format",
				"markdown",
				"--output",
				outputPath,
			]);

			expect(result.exitCode).toBe(1);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe("");
			await expect(readFile(outputPath, "utf8")).resolves.toContain(
				"# Vault Inspector Report",
			);
		});
	});

	it("rejects fix execution because CLI fixes are not implemented yet", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const result = await runCli(["scan", vaultPath, "--fix"]);

			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(
				"CLI fix execution is not available yet",
			);
		});
	});

	it("loads config and applies scanner, severity, include, and exclude filters", async () => {
		await withVault(
			{
				"active/empty.md": "",
				"drafts/empty.md": "",
				"active/large.md": "x".repeat(30),
			},
			async (vaultPath) => {
				const configPath = join(vaultPath, "vault-inspector.config.json");
				await writeFile(
					configPath,
					JSON.stringify({
						scanners: ["empty-notes", "large-files"],
						severity: ["warning"],
						include: ["active/**"],
						exclude: ["**/large.md"],
						largeMarkdownBytes: 10,
					}),
					"utf8",
				);

				const result = await runCli(["scan", vaultPath, "--config", configPath]);

				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(1);
				expect(payload.issues).toEqual([
					expect.objectContaining({
						scannerId: "empty-notes",
						primaryPath: "active/empty.md",
					}),
				]);
			},
		);
	});

	it("lets CLI flags override config values", async () => {
		await withVault({ "empty.md": "", "large.md": "x".repeat(30) }, async (vaultPath) => {
			const configPath = join(vaultPath, "vault-inspector.config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					scanners: ["large-files"],
					largeMarkdownBytes: 10,
				}),
				"utf8",
			);

			const result = await runCli([
				"scan",
				vaultPath,
				"--config",
				configPath,
				"--scanner",
				"empty-notes",
			]);

			const payload = JSON.parse(result.stdout);
			expect(payload.summary.scannersRun).toEqual(["empty-notes"]);
			expect(payload.issues[0].scannerId).toBe("empty-notes");
		});
	});

	it("loads config for large markdown ignore rules", async () => {
		await withVault(
			{
				"drawings/diagram.md":
					"---\nexcalidraw-plugin: parsed\n---\n" + "x".repeat(30),
				"index/source.canvas.md": "x".repeat(30),
				"notes/large.md": "x".repeat(30),
			},
			async (vaultPath) => {
				const configPath = join(vaultPath, "vault-inspector.config.json");
				await writeFile(
					configPath,
					JSON.stringify({
						scanners: ["large-files"],
						largeMarkdownBytes: 10,
						ignoredLargeMarkdownFrontmatterKeys: ["excalidraw-plugin"],
						ignoredLargeMarkdownPathPatterns: ["index/**/*.md"],
					}),
					"utf8",
				);

				const result = await runCli(["scan", vaultPath, "--config", configPath]);

				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(1);
				expect(payload.issues).toEqual([
					expect.objectContaining({
						scannerId: "large-files",
						primaryPath: "notes/large.md",
					}),
				]);
			},
		);
	});

	it("loads unresolved note filtering from config without hiding other broken links", async () => {
		await withVault(
			{
				"Source.md": [
					"[[Future Note]]",
					"![[Missing Note]]",
					"![[assets/missing.png]]",
					"[Missing](missing.md)",
					"[[Target#Missing]]",
				].join("\n"),
				"Target.md": "# Existing\n",
			},
			async (vaultPath) => {
				const configPath = join(vaultPath, "vault-inspector.config.json");
				await writeFile(
					configPath,
					JSON.stringify({
						scanners: ["broken-links"],
						ignoreUnresolvedNoteLinks: true,
					}),
					"utf8",
				);

				const result = await runCli([vaultPath, "--config", configPath]);

				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(4);
				expect(payload.issues.map((issue: { message: string }) => issue.message))
					.toEqual(expect.arrayContaining([
						"Linked file not found: Missing Note",
						"Attachment not found: assets/missing.png",
						"Linked file not found: missing.md",
						'Heading "#Missing" not found in Target.md',
					]));
				expect(payload.issues).not.toContainEqual(
					expect.objectContaining({
						message: "Linked file not found: Future Note",
					}),
				);
			},
		);
	});

	it("rejects a non-boolean unresolved note config value", async () => {
		await withVault({ "Source.md": "[[Future Note]]\n" }, async (vaultPath) => {
			const configPath = join(vaultPath, "vault-inspector.config.json");
			await writeFile(
				configPath,
				JSON.stringify({ ignoreUnresolvedNoteLinks: "yes" }),
				"utf8",
			);

			const result = await runCli([vaultPath, "--config", configPath]);

			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(
				"ignoreUnresolvedNoteLinks must be a boolean",
			);
		});
	});

	it("uses fail-on to control exit status", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const belowThreshold = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"error",
			]);

			expect(belowThreshold.exitCode).toBe(0);
			expect(JSON.parse(belowThreshold.stdout).summary.warnings).toBe(1);

			const matchingThreshold = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"warning",
			]);
			expect(matchingThreshold.exitCode).toBe(1);

			const disabled = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			expect(disabled.exitCode).toBe(0);
		});
	});

	it("resolves short wiki embeds to attachment files in subfolders", async () => {
		await withVault(
			{
				"note.md": "![[image.png]]\n\nEnough content to avoid empty note warnings.\n",
				"attachments/image.png": "fake image bytes",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links,orphan-attachments",
				]);

				expect(result.exitCode).toBe(0);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(0);
				expect(payload.issues).toEqual([]);
			},
			);
	});

	it("exposes Obsidian-shaped resolved links and source-aware link resolution", async () => {
		await withVault(
			{
				"zeta/note.md": "![[image.png]]\n",
				"zeta/image.png": "local image",
				"alpha/image.png": "other image",
			},
			async (vaultPath) => {
				const app = await createLocalApp(vaultPath);

				expect(app.metadataCache.resolvedLinks).toEqual({
					"zeta/note.md": {
						"zeta/image.png": 1,
					},
				});
				expect(
					app.metadataCache.getFirstLinkpathDest("image.png", "zeta/note.md")?.path,
				).toBe("zeta/image.png");
			},
		);
	});

	it("reports a missing heading when the linked CLI note exists", async () => {
		await withVault(
			{
				"notes/source.md": "[[target#Missing heading]]\n",
				"notes/target.md": "# Existing heading\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links",
				]);

				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.issues).toEqual([
					expect.objectContaining({
						scannerId: "broken-links",
						severity: "warning",
						primaryPath: "notes/source.md",
						relatedPaths: ["notes/target.md"],
						evidence: expect.objectContaining({
							link: "target#Missing heading",
							target: "notes/target.md",
						}),
					}),
				]);
			},
		);
	});

	it("does not scan Obsidian and version-control internals", async () => {
		await withVault(
			{
				"note.md": "Visible content with enough words for the scan.\n",
				".obsidian/workspace.md": "",
				".git/hooks/example.md": "",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"empty-notes",
				]);

				expect(result.exitCode).toBe(0);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.filesScanned).toBe(1);
				expect(payload.issues).toEqual([]);
			},
		);
	});

	it("parses CRLF frontmatter with YAML block sequence tags", async () => {
		await withVault(
			{
				"note.md": [
					"---",
					"tags:",
					"  - release",
					"  - 项目/进行中",
					"---",
					"Enough body content for the scan.",
				].join("\r\n"),
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"tag-usage",
				]);

				expect(result.exitCode).toBe(1);
				const tags = JSON.parse(result.stdout).issues.map(
					(issue: { evidence: { tag: string } }) => issue.evidence.tag,
				);
				expect(tags).toEqual(["release", "项目/进行中"]);
			},
		);
	});

	it("ignores pseudo links and tags in code and HTML comments", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			status: 404,
		} as Response);

		await withVault(
			{
				"note.md": [
					"Enough visible content for the scan.",
					"",
					"`[[inline-missing]] #inline-tag https://example.com/inline`",
					"",
					"```md",
					"[[fenced-missing]] #fenced-tag",
					"[dead](https://example.com/fenced)",
					"```",
					"",
					"<!-- [[comment-missing]] #comment-tag https://example.com/comment -->",
				].join("\n"),
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links,external-links,tag-usage",
				]);

				expect(result.exitCode).toBe(0);
				expect(fetchMock).not.toHaveBeenCalled();
				expect(JSON.parse(result.stdout).issues).toEqual([]);
			},
		);
	});

	it("resolves relative Markdown links with titles and ignores URI schemes", async () => {
		await withVault(
			{
				"notes/source.md": [
					'[Target](../docs/target.md "Read target")',
					"[Email](mailto:person@example.com)",
					"[Obsidian](obsidian://open?vault=Example)",
					"[Custom](custom:resource#section)",
				].join("\n"),
				"docs/target.md": "# Target\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links",
				]);

				expect(result.exitCode).toBe(0);
				expect(JSON.parse(result.stdout).issues).toEqual([]);
			},
		);
	});

	it("does not report an existing heading in a source-relative Markdown link", async () => {
		await withVault(
			{
				"notes/source.md": "[Target](sub/target.md#Existing)\n",
				"notes/sub/target.md": "# Existing\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links",
				]);

				expect(result.exitCode).toBe(0);
				expect(JSON.parse(result.stdout).issues).toEqual([]);
			},
		);
	});

	it("reports only a missing heading in a source-relative Markdown link", async () => {
		await withVault(
			{
				"notes/source.md": "[Target](sub/target.md#Missing)\n",
				"notes/sub/target.md": "# Existing\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links",
				]);

				expect(result.exitCode).toBe(1);
				const issues = JSON.parse(result.stdout).issues;
				expect(issues).toEqual([
					expect.objectContaining({
						scannerId: "broken-links",
						severity: "warning",
						message:
							'Heading "#Missing" not found in notes/sub/target.md',
						relatedPaths: ["notes/sub/target.md"],
						evidence: expect.objectContaining({
							target: "notes/sub/target.md",
						}),
					}),
				]);
				// The fix is a label-preserving literal replacement, not the
				// wiki-only removal pattern.
				expect(issues[0].fixAction).toEqual({
					kind: "remove-link-text",
					label: "Remove link",
					description:
						'Replace "[Target](sub/target.md#Missing)" with "Target" in "notes/source.md"',
					targetPaths: ["notes/source.md"],
					original: "[Target](sub/target.md#Missing)",
					replacement: "Target",
				});
			},
		);
	});

	it("reports missing Markdown files without an unsafe wiki removal action", async () => {
		await withVault(
			{
				"notes/source.md": "[Missing](missing.md)\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links",
				]);

				expect(result.exitCode).toBe(1);
				const issues = JSON.parse(result.stdout).issues;
				expect(issues).toEqual([
					expect.objectContaining({
						scannerId: "broken-links",
						severity: "error",
						message: "Linked file not found: missing.md",
					}),
				]);
				// Safe label-preserving replacement; the unsafe wiki removal
				// pattern (linkText) is never emitted for Markdown syntax.
				expect(issues[0].fixAction).toEqual({
					kind: "remove-link-text",
					label: "Remove link",
					description:
						'Replace "[Missing](missing.md)" with "Missing" in "notes/source.md"',
					targetPaths: ["notes/source.md"],
					original: "[Missing](missing.md)",
					replacement: "Missing",
				});
				expect(issues[0].fixAction).not.toHaveProperty("linkText");
			},
		);
	});

	it("adds additive eligibility and impact fields to fix actions while keeping fix metadata stable", async () => {
		await withVault(
			{
				"notes/source.md": "[Missing](missing.md)\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links",
				]);

				expect(result.exitCode).toBe(1);
				const issues = JSON.parse(result.stdout).issues;
				expect(issues).toEqual([
					expect.objectContaining({
						scannerId: "broken-links",
						classification: "confirmed",
						eligibility: "eligible",
						impact: {
							filesChanged: 1,
							filesTrashed: 0,
							inboundReferences: 0,
							coverageComplete: true,
						},
					}),
				]);
				// Every pre-existing fix-action field is emitted unchanged.
				expect(issues[0].fixAction).toEqual({
					kind: "remove-link-text",
					label: "Remove link",
					description:
						'Replace "[Missing](missing.md)" with "Missing" in "notes/source.md"',
					targetPaths: ["notes/source.md"],
					original: "[Missing](missing.md)",
					replacement: "Missing",
				});
			},
		);
	});

	it("marks candidate trash findings as review-required in CLI output", async () => {
		await withVault(
			{
				"empty.md": "# Empty\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"empty-notes",
				]);

				expect(result.exitCode).toBe(1);
				const issues = JSON.parse(result.stdout).issues;
				expect(issues).toEqual([
					expect.objectContaining({
						scannerId: "empty-notes",
						classification: "candidate",
						eligibility: "review-required",
						impact: {
							filesChanged: 0,
							filesTrashed: 1,
							inboundReferences: 0,
							coverageComplete: true,
						},
					}),
				]);
				expect(issues[0].fixAction).toMatchObject({
					kind: "trash-file",
					targetPaths: ["empty.md"],
				});
			},
		);
	});

	it("ignores unresolved plain note wikilinks through a CLI flag", async () => {
		await withVault(
			{
				"Source.md": "[[Future Note]]\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					vaultPath,
					"--scanner",
					"broken-links",
					"--ignore-unresolved-note-links",
				]);

				expect(result.exitCode).toBe(0);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(0);
				expect(payload.issues).toEqual([]);
			},
		);
	});

	it("keeps wiki subpaths vault-root relative", async () => {
		await withVault(
			{
				"notes/source.md": "[[sub/target#Root heading]]\n",
				"notes/sub/target.md": "# Source-relative heading\n",
				"sub/target.md": "# Root heading\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links",
				]);

				expect(result.exitCode).toBe(0);
				expect(JSON.parse(result.stdout).issues).toEqual([]);
			},
		);
	});

	it("does not report attachments referenced by frontmatter properties", async () => {
		await withVault(
			{
				"note.md": [
					"---",
					"type: note",
					'sourceBackup: "[[myBackup.pdf]]"',
					"references:",
					'  - "[[myReferencedFile.pdf]]"',
					"---",
					"# Content",
				].join("\n"),
				"attachments/myBackup.pdf": "fake backup",
				"attachments/myReferencedFile.pdf": "fake reference",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"orphan-attachments",
				]);

				expect(result.exitCode).toBe(0);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(0);
				expect(payload.issues).toEqual([]);
			},
		);
	});

	it("detects non-English inline tags in CLI scans", async () => {
		await withVault(
			{
				"note.md": "#项目/进行中\n\nEnough content to avoid empty note warnings.\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"tag-usage",
				]);

				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.issues).toEqual([
					expect.objectContaining({
						scannerId: "tag-usage",
						primaryPath: "note.md",
						evidence: expect.objectContaining({
							tag: "项目/进行中",
						}),
					}),
				]);
			},
		);
	});

	it("checks external links in CLI scans with the secured request adapter", async () => {
		const requestUrl = vi.fn(async () => ({ status: 404, method: "HEAD" as const }));
		const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new Error("global fetch must not be used"),
		);

		await withVault(
			{
				"note.md": "[Dead link](https://example.com/dead)\n\nEnough content to avoid empty note warnings.\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"external-links",
				], { requestUrl });

				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/dead",
					"HEAD",
					expect.any(AbortSignal),
				);
				expect(fetchMock).not.toHaveBeenCalled();
				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.issues).toEqual([
					expect.objectContaining({
						scannerId: "external-links",
						severity: "warning",
						primaryPath: "note.md",
						evidence: expect.objectContaining({
							url: "https://example.com/dead",
							status: 404,
						}),
					}),
				]);
			},
		);
	});

	it("checks bare external URLs in CLI scans", async () => {
		const requestUrl = vi.fn(async () => ({ status: 404, method: "HEAD" as const }));

		await withVault(
			{
				"note.md": "https://example.com/bare.\n\nEnough content to avoid empty note warnings.\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"external-links",
				], { requestUrl });

				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/bare",
					"HEAD",
					expect.any(AbortSignal),
				);
				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.issues).toEqual([
					expect.objectContaining({
						scannerId: "external-links",
						primaryPath: "note.md",
						evidence: expect.objectContaining({
							url: "https://example.com/bare",
						}),
					}),
				]);
			},
		);
	});

	it("blocks the original loopback SSRF path without reaching the server", async () => {
		let receivedRequests = 0;
		const server = createServer((_request, response) => {
			receivedRequests++;
			response.writeHead(200).end();
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});

		try {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("Expected TCP loopback server address");
			}
			await withVault(
				{
					"note.md": `http://127.0.0.1:${address.port}/private\n`,
				},
				async (vaultPath) => {
					const result = await runCli([
						"scan",
						vaultPath,
						"--scanner",
						"external-links",
					]);
					const payload = JSON.parse(result.stdout);

					expect(receivedRequests).toBe(0);
					expect(payload.issues).toEqual([
						expect.objectContaining({
							title: "External link check blocked",
							evidence: expect.objectContaining({
								url: `http://127.0.0.1:${address.port}/private`,
								reason: "non-public IP address",
							}),
						}),
					]);
				},
			);
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => error ? reject(error) : resolve());
			});
		}
	});

	it("aborts timed out CLI external-link requests", async () => {
		let aborted = false;
		const requestUrl = vi.fn(
			(_url: string, _method: "HEAD" | "GET", signal?: AbortSignal) =>
				new Promise<{ status: number; method: "HEAD" | "GET" }>((_resolve, reject) => {
					signal?.addEventListener("abort", () => {
						aborted = true;
						reject(new DOMException("The operation was aborted", "AbortError"));
					});
				}),
		);

		await withVault(
			{
				"note.md": "[Slow](https://example.com/slow)\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"external-links",
				], { requestUrl });

				expect(aborted).toBe(true);
				expect(requestUrl).toHaveBeenCalledWith(
					"https://example.com/slow",
					"HEAD",
					expect.any(AbortSignal),
				);
				expect(JSON.parse(result.stdout).issues).toEqual([
					expect.objectContaining({
						title: "External link check timed out",
						evidence: expect.objectContaining({
							url: "https://example.com/slow",
						}),
					}),
				]);
			},
		);
	}, EXTERNAL_LINK_TIMEOUT_MS + 5000);

	it("marks baseline issues and fails only on new issues", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"new",
			]);
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, first.stdout, "utf8");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"new",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(0);
			expect(payload.summary.issues).toBe(1);
			expect(payload.summary.newIssues).toBe(0);
			expect(payload.issues[0].isNew).toBe(false);
			expect(second.stderr).toBe("");
			expect(payload.comparison).toEqual({
				available: true,
				mode: "profile",
				newIssues: 0,
				persistingIssues: 1,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
		});
	});

	it("reports profile comparison counts including resolved issues", async () => {
		await withVault({ "keep.md": "", "drop.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, first.stdout, "utf8");

			await rm(join(vaultPath, "drop.md"), { force: true });
			await writeFile(join(vaultPath, "added.md"), "");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"new",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(1);
			expect(second.stderr).toBe("");
			expect(payload.comparison).toEqual({
				available: true,
				mode: "profile",
				newIssues: 1,
				persistingIssues: 1,
				resolvedIssues: 1,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			// The same fingerprint set drives isNew and the counts.
			expect(payload.issues.find(
				(issue: { isNew?: boolean }) => issue.isNew === true,
			).primaryPath).toBe("added.md");
			expect(payload.issues.find(
				(issue: { isNew?: boolean }) => issue.isNew === false,
			).primaryPath).toBe("keep.md");
		});
	});

	it("compares legacy baselines with a stderr warning", async () => {
		await withVault({ "keep.md": "", "drop.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baseline = JSON.parse(first.stdout);
			delete baseline.comparison;
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, JSON.stringify(baseline), "utf8");

			await rm(join(vaultPath, "drop.md"), { force: true });
			await writeFile(join(vaultPath, "added.md"), "");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"new",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(1);
			expect(second.stderr).toContain(
				"Baseline " + baselinePath + " has no scan profile metadata",
			);
			expect(second.stderr).toContain("legacy mode");
			expect(payload.comparison).toEqual({
				available: true,
				mode: "legacy",
				newIssues: 1,
				persistingIssues: 1,
				resolvedIssues: 1,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			expect(payload.issues.find(
				(issue: { isNew?: boolean }) => issue.isNew === true,
			).primaryPath).toBe("added.md");
			expect(payload.issues.find(
				(issue: { isNew?: boolean }) => issue.isNew === false,
			).primaryPath).toBe("keep.md");
		});
	});

	it("fails with exit code 2 when baseline settings changed", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, first.stdout, "utf8");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"broken-links,empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"new",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(2);
			expect(second.stderr).toContain("settings-changed");
			expect(payload.comparison).toEqual({
				available: false,
				mode: "profile",
				reason: "settings-changed",
				newIssues: 0,
				persistingIssues: 0,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			// No lifecycle annotations are fabricated from an incompatible baseline.
			expect(payload.issues.every(
				(issue: { isNew?: boolean }) => issue.isNew === undefined,
			)).toBe(true);
		});
	});

	it("fails with exit code 2 when baseline comparison semantics changed", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baseline = JSON.parse(first.stdout);
			baseline.comparison.comparisonVersion = 3;
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, JSON.stringify(baseline), "utf8");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"none",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(2);
			expect(second.stderr).toContain("semantics-changed");
			expect(payload.comparison).toEqual({
				available: false,
				mode: "profile",
				reason: "semantics-changed",
				newIssues: 0,
				persistingIssues: 0,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			expect(payload.issues.every(
				(issue: { isNew?: boolean }) => issue.isNew === undefined,
			)).toBe(true);
		});
	});

	it("rejects malformed baseline comparison metadata", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baseline = JSON.parse(first.stdout);
			baseline.comparison = { scanProfile: 1 };
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, JSON.stringify(baseline), "utf8");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"none",
			]);

			expect(second.exitCode).toBe(2);
			expect(second.stdout).toBe("");
			expect(second.stderr).toContain("Invalid baseline");
		});
	});
});

