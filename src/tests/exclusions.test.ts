import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalApp } from "../../cli/local-vault";
import { ScanRunner } from "../scanner/ScanRunner";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { brokenLinksScanner } from "../scanner/scanners/broken-links";
import { orphanAttachmentsScanner } from "../scanner/scanners/orphan-attachments";
import { tagUsageScanner } from "../scanner/scanners/tag-usage";
import { createScanProfile } from "../scanner/scan-profile";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
	const dir = await mkdtemp(join(tmpdir(), "vi-exclusions-"));
	dirs.push(dir);
	await writeFile(join(dir, "Clip.md"), "---\ntags: [clippings/web, shared]\n---\n[[Missing]] ![[image.png]]\n# Heading");
	await writeFile(join(dir, "Body.md"), "#clippings [[Missing]]");
	await writeFile(join(dir, "Other.md"), "#clippings-other [[Clip#Heading]] [[Missing]]");
	await writeFile(join(dir, "image.png"), "image");
	return createLocalApp(dir);
}
describe("scan exclusions", () => {
	it("matches both tag sources and descendants, retains targets and attachment references", async () => {
		const app = await fixture();
		const settings = structuredClone(DEFAULT_SETTINGS);
		Object.assign(settings, { exclusionRules: [{ kind: "tag", value: "#clippings", scanners: "all" }] });
		const runner = new ScanRunner();
		runner.register(brokenLinksScanner);
		runner.register(orphanAttachmentsScanner);
		const result = await runner.run(app, settings);
		expect(result.issues.map((issue) => [issue.scannerId, issue.primaryPath])).toEqual([["broken-links", "Other.md"]]);
		expect(result.issues[0].evidence.target).toBe("Missing");
		expect(result.exclusions).toContainEqual({ scannerId: "orphan-attachments", excludedFiles: 0, ruleCount: 1 });
		expect(result).toHaveProperty("exclusions", expect.arrayContaining([expect.objectContaining({ scannerId: "broken-links", excludedFiles: 2 })]));
	});
	it("limits rules to selected scanners and counts tags within the participating scope", async () => {
		const app = await fixture();
		const settings = structuredClone(DEFAULT_SETTINGS);
		Object.assign(settings, { exclusionRules: [{ kind: "tag", value: "clippings", scanners: ["broken-links"] }] });
		settings.watchedTags = ["shared"];
		const runner = new ScanRunner(); runner.register(brokenLinksScanner); runner.register(tagUsageScanner);
		let result = await runner.run(app, settings);
		expect(result.issues.some((issue) => issue.title === "Missing watched tag")).toBe(false);
		Object.assign(settings, { exclusionRules: [{ kind: "tag", value: "clippings", scanners: "all" }] });
		result = await runner.run(app, settings);
		expect(result.issues.find((issue) => issue.title === "Missing watched tag")?.message).toContain("scan scope");
	});
	it("changes profile for exclusions but preserves it when legacy folders become rules", async () => {
		const settings = structuredClone(DEFAULT_SETTINGS);
		const before = await createScanProfile(settings);
		Object.assign(settings, { exclusionRules: [{ kind: "tag", value: "clippings", scanners: "all" }] });
		expect(await createScanProfile(settings)).not.toBe(before);
		const legacy = structuredClone(DEFAULT_SETTINGS); legacy.ignoredFolders = ["archive/"];
		const migrated = structuredClone(DEFAULT_SETTINGS);
		Object.assign(migrated, { exclusionRules: [{ kind: "folder", value: "archive", scanners: "all" }] });
		expect(await createScanProfile(legacy)).toBe(await createScanProfile(migrated));
	});
});

describe("scan exclusion reporting", () => {
	it("reports scope separately from ignored findings in full and summary exports", async () => {
		const { generateMarkdownReport } = await import("../report/markdown-export");
		const app = await fixture();
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.exclusionRules = [{ kind: "tag", value: "clippings", scanners: ["broken-links"] }];
		const runner = new ScanRunner(); runner.register(brokenLinksScanner);
		const result = await runner.run(app, settings);
		for (const mode of ["full", "summary"] as const) {
			const markdown = generateMarkdownReport(result, mode);
			expect(markdown).toContain("| Broken Links | 2 | 1 |");
			expect(markdown).toContain("not additive");
		}
		expect(result.ignoredIssues).toEqual([]);
	});
});
