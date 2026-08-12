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
			expect(payload).not.toHaveProperty("comparison");
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
				expect(issues[0]).not.toHaveProperty("fixAction");
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
				expect(issues[0]).not.toHaveProperty("fixAction");
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
		const requestUrl = vi.fn(async () => 404);
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
		const requestUrl = vi.fn(async () => 404);

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
			(_url: string, signal?: AbortSignal) => new Promise<number>((_resolve, reject) => {
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
		});
	});
});
