import { describe, expect, it } from "vitest";
import { generateMarkdownReport } from "../report/markdown-export";
import type { ScanResult } from "../scanner/Issue";

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
	return {
		startedAt: 1000,
		finishedAt: 2500,
		filesScanned: 3,
		scannersRun: ["duplicate-files", "tag-usage", "frontmatter-types"],
		issues: [],
		ignoredIssues: [],
		...overrides,
	};
}

describe("generateMarkdownReport", () => {
	it("renders compact summaries without finding details", () => {
		const markers = [
			"ACTIVE_TITLE_MARKER",
			"ACTIVE_MESSAGE_MARKER",
			"ACTIVE_PRIMARY_PATH_MARKER",
			"ACTIVE_RELATED_PATH_MARKER",
			"ACTIVE_TARGET_MARKER",
			"unverified",
			"ACTIVE_WHY_MARKER",
			"ACTIVE_CAVEAT_MARKER",
			"ACTIVE_NEXT_STEP_MARKER",
			"IGNORED_TITLE_MARKER",
			"IGNORED_MESSAGE_MARKER",
			"IGNORED_PATH_MARKER",
			"IGNORED_TARGET_MARKER",
		];
		const report = generateMarkdownReport(makeResult({
			scannersRun: ["broken-links", "empty-notes"],
			issues: [{
				scannerId: "broken-links",
				severity: "error",
				classification: "unverified",
				explanation: {
					why: "ACTIVE_WHY_MARKER",
					caveat: "ACTIVE_CAVEAT_MARKER",
					nextStep: "ACTIVE_NEXT_STEP_MARKER",
				},
				title: "ACTIVE_TITLE_MARKER",
				message: "ACTIVE_MESSAGE_MARKER",
				primaryPath: "ACTIVE_PRIMARY_PATH_MARKER",
				relatedPaths: ["ACTIVE_RELATED_PATH_MARKER"],
				evidence: { target: "ACTIVE_TARGET_MARKER" },
				fingerprint: "active",
			}],
			ignoredIssues: [{
				scannerId: "empty-notes",
				severity: "warning",
				classification: "candidate",
				explanation: {
					why: "IGNORED_TITLE_MARKER",
					nextStep: "IGNORED_MESSAGE_MARKER",
				},
				title: "IGNORED_TITLE_MARKER",
				message: "IGNORED_MESSAGE_MARKER",
				primaryPath: "IGNORED_PATH_MARKER",
				relatedPaths: [],
				evidence: { target: "IGNORED_TARGET_MARKER" },
				fingerprint: "ignored",
			}],
		}), "summary");

		expect(report).toContain("# Vault Inspector Summary");
		expect(report).toContain("Finding details are omitted from this summary.");
		expect(report).toContain("| Total | 1 |");
		expect(report).toContain("| Errors | 1 |");
		expect(report).toMatch(/\| Broken Links \| 1 \|[\s\S]*\| Empty Notes \| 0 \|/);
		for (const marker of markers) expect(report).not.toContain(marker);
		expect(report).not.toContain("- **Classification:**");
		expect(report).not.toContain("- **Why:**");
		expect(report).not.toContain("- **Next step:**");
		expect(report).not.toMatch(/^- \*\*(?:Lifecycle|Status):\*\*/m);
		expect(report).not.toMatch(/^## Resolved(?: items| findings)?/m);
	});

	it("renders scanner-specific details for human-readable reports", () => {
		const report = generateMarkdownReport(makeResult({
			issues: [
				{
					scannerId: "duplicate-files",
					severity: "info",
					classification: "candidate",
					explanation: {
						why: "Two files share the same filename.",
						caveat: "Matching names do not prove matching content.",
						nextStep: "Compare both files.",
					},
					title: "Duplicate file candidates (same name)",
					message: "2 files share the name \"note.md\"",
					relatedPaths: ["a/note.md", "b/note.md"],
					evidence: {
						count: 2,
						paths: "a/note.md, b/note.md",
					},
					fingerprint: "duplicate",
				},
				{
					scannerId: "tag-usage",
					severity: "info",
					classification: "confirmed",
					explanation: {
						why: "Test evidence confirms this fixture.",
						nextStep: "Review the test fixture.",
					},
					title: "Low-usage tag",
					message: "Tag \"rare\" is only used 1 time(s), below threshold of 2",
					primaryPath: "tags.md",
					relatedPaths: [],
					evidence: {
						tag: "rare",
						count: 1,
						threshold: 2,
					},
					fingerprint: "tag",
				},
				{
					scannerId: "frontmatter-types",
					severity: "warning",
					classification: "confirmed",
					explanation: {
						why: "Test evidence confirms this fixture.",
						nextStep: "Review the test fixture.",
					},
					title: "Frontmatter type drift",
					message: "Property \"priority\" has mixed types: number (1), string (1)",
					relatedPaths: ["one.md", "two.md"],
					evidence: {
						property: "priority",
						types: "number (1), string (1)",
						fileCount: 2,
					},
					fingerprint: "frontmatter",
				},
			],
		}));

		expect(report).toContain("### Duplicate file candidates (same name)");
		expect(report).toContain("- **Classification:** candidate");
		expect(report).toContain("- **Why:** Two files share the same filename.");
		expect(report).toContain("- **Caveat:** Matching names do not prove matching content.");
		expect(report).toContain("- **Next step:** Compare both files.");
		expect(report).toContain("- **Files:**\n  - `a/note.md`\n  - `b/note.md`");
		expect(report).toContain("- **Tag:** #rare");
		expect(report).toContain("- **Files:**\n  - `tags.md`");
		expect(report).toContain("- **Property:** `priority`");
		expect(report).toContain("- **Samples:**\n  - `one.md`\n  - `two.md`");
		expect(report.match(/^- \*\*Classification:\*\*/gm)).toHaveLength(3);
		expect(report.match(/^- \*\*Why:\*\*/gm)).toHaveLength(3);
		expect(report.match(/^- \*\*Caveat:\*\*/gm)).toHaveLength(1);
		expect(report.match(/^- \*\*Next step:\*\*/gm)).toHaveLength(3);
		expect(report).not.toMatch(
			/^- \*\*(?:Lifecycle|Status):\*\* (?:New|Persisting|Resolved)$/m,
		);
		expect(report).not.toMatch(/^## Resolved(?: items| findings)?/m);
	});
});
