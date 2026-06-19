import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../cli/cli";

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
			expect(payload.tool).toBe("vault-inspector");
			expect(payload.schemaVersion).toBe(1);
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
				}),
			]);
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
				"drawings/diagram.md": "---\nexcalidraw: true\n---\n" + "x".repeat(30),
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
						ignoredLargeMarkdownFrontmatterKeys: ["excalidraw"],
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
			const result = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"error",
			]);

			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout).summary.warnings).toBe(1);
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

	it("checks external links in CLI scans with fetch HEAD requests", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			status: 404,
		} as Response);

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
				]);

				expect(fetchMock).toHaveBeenCalledWith("https://example.com/dead", {
					method: "HEAD",
				});
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
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
			status: 404,
		} as Response);

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
				]);

				expect(fetchMock).toHaveBeenCalledWith("https://example.com/bare", {
					method: "HEAD",
				});
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
