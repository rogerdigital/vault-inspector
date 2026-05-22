import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli/cli";

async function withVault(
	files: Record<string, string>,
	fn: (vaultPath: string) => Promise<void>,
): Promise<void> {
	const vaultPath = await mkdtemp(join(tmpdir(), "vault-inspector-"));
	try {
		for (const [path, content] of Object.entries(files)) {
			await writeFile(join(vaultPath, path), content, "utf8");
		}
		await fn(vaultPath);
	} finally {
		await rm(vaultPath, { recursive: true, force: true });
	}
}

describe("runCli", () => {
	it("prints machine-readable JSON scan results", async () => {
		await withVault({ "empty.md": "# Empty\n" }, async (vaultPath) => {
			const result = await runCli(["scan", vaultPath, "--format", "json"]);

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toBe("");

			const payload = JSON.parse(result.stdout);
			expect(payload.tool).toBe("vault-inspector");
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
});
