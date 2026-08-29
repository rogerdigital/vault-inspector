import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createLocalApp } from "../../cli/local-vault";
import { ScanRunner } from "../scanner/ScanRunner";
import { registerDefaultScanners } from "../scanner/register-scanners";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { generateSyntheticVault } from "./helpers/synthetic-vault";

describe("scan performance baseline", () => {
	it(
		"scans a synthetic vault without external links well inside the regression bound",
		async () => {
			const vaultDir = await mkdtemp(join(tmpdir(), "vault-inspector-perf-"));
			try {
				const generated = await generateSyntheticVault(vaultDir, {
					notes: 120,
					attachments: 40,
				});
				const app = await createLocalApp(vaultDir);
				const scanRunner = new ScanRunner();
				registerDefaultScanners(scanRunner);
				const settings = structuredClone(DEFAULT_SETTINGS);

				const startedAt = performance.now();
				const result = await scanRunner.run(app, settings);
				const durationMs = performance.now() - startedAt;

				expect(result.filesScanned).toBe(
					generated.markdownFiles + generated.attachmentFiles,
				);
				expect(result.scannersRun).not.toContain("external-links");
				expect(result.issues.length).toBeGreaterThan(0);
				expect(durationMs).toBeLessThan(30_000);
			} finally {
				await rm(vaultDir, { recursive: true, force: true });
			}
		},
		120_000,
	);
});
