import { describe, expect, it } from "vitest";
import type { Issue, ScanResult, ScannerId } from "../scanner/Issue";
import { buildIssueFilterView } from "../report/report-model";
import { renderSummary } from "../report/render-summary";

class FakeElement {
	children: FakeElement[] = [];
	text: string | null;

	constructor(options: { text?: string } = {}) {
		this.text = options.text ?? null;
	}

	createDiv(options: { text?: string } = {}): FakeElement {
		const child = new FakeElement(options);
		this.children.push(child);
		return child;
	}

	createSpan(options: { text?: string } = {}): FakeElement {
		const child = new FakeElement(options);
		this.children.push(child);
		return child;
	}

	createEl(_tag: string, options: { text?: string } = {}): FakeElement {
		const child = new FakeElement(options);
		this.children.push(child);
		return child;
	}

	addClass(): void {}
	addEventListener(): void {}
}

function makeIssue(scannerId: ScannerId, severity: Issue["severity"], fingerprint: string): Issue {
	return {
		scannerId,
		severity,
		classification: "confirmed",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: fingerprint,
		message: fingerprint,
		relatedPaths: [],
		evidence: {},
		fingerprint,
	};
}

const issues = [
	makeIssue("broken-links", "error", "broken-error"),
	makeIssue("duplicate-files", "warning", "duplicate-warning"),
	makeIssue("duplicate-files", "info", "duplicate-info"),
];

const result: ScanResult = {
	startedAt: 0,
	finishedAt: 1000,
	issues,
	ignoredIssues: [],
	filesScanned: 3,
	scannersRun: ["broken-links", "duplicate-files"],
};

describe("report filters", () => {
	it("renders summary counts from the explicitly visible issues", () => {
		const container = new FakeElement();

		renderSummary(container as unknown as HTMLElement, result, {
			issues: [],
			onFilterSeverity: () => {},
		});

		const stats = container.children[0].children[1].children;
		const values = Object.fromEntries(stats.map((stat) => [
			stat.children[1].text,
			Number(stat.children[0].text),
		]));

		expect(values).toEqual({
			Total: 0,
			Errors: 0,
			Warnings: 0,
			Info: 0,
		});
	});

	it("derives visible issues, summary, and faceted counts from active filters", () => {
		const filtered = buildIssueFilterView(issues, {
			scanner: "duplicate-files",
			severity: "error",
		});

		expect(filtered.visibleIssues).toEqual([]);
		expect(filtered.scannerCounts.get("broken-links")).toBe(1);
		expect(filtered.scannerCounts.get("duplicate-files")).toBe(0);
		expect(filtered.severityFacets).toEqual([
			{ severity: "error", count: 0 },
			{ severity: "warning", count: 1 },
			{ severity: "info", count: 1 },
		]);

		const withoutSeverity = buildIssueFilterView(issues, {
			scanner: "duplicate-files",
			severity: null,
		});

		expect(withoutSeverity.visibleIssues.map((issue) => issue.fingerprint)).toEqual([
			"duplicate-warning",
			"duplicate-info",
		]);
	});
});
