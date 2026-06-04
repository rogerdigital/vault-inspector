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
	it("renders scanner-specific details for human-readable CLI reports", () => {
		const report = generateMarkdownReport(makeResult({
			issues: [
				{
					scannerId: "duplicate-files",
					severity: "info",
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
		expect(report).toContain("- **Files:**\n  - `a/note.md`\n  - `b/note.md`");
		expect(report).toContain("- **Tag:** #rare");
		expect(report).toContain("- **Files:**\n  - `tags.md`");
		expect(report).toContain("- **Property:** `priority`");
		expect(report).toContain("- **Samples:**\n  - `one.md`\n  - `two.md`");
	});
});
