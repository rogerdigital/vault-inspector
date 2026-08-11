import { describe, expect, it } from "vitest";
import type {
	FindingClassification,
	Issue,
	ScannerId,
} from "../scanner/Issue";
import type { CurrentFindingStatus } from "../scanner/result-diff";
import { buildIssueFilterView } from "../report/report-model";

function makeIssue(
	scannerId: ScannerId,
	severity: Issue["severity"],
	fingerprint: string,
	options: {
		classification?: FindingClassification;
		primaryPath?: string;
		relatedPaths?: string[];
	} = {},
): Issue {
	return {
		scannerId,
		severity,
		classification: options.classification ?? "confirmed",
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: fingerprint,
		message: fingerprint,
		...(options.primaryPath ? { primaryPath: options.primaryPath } : {}),
		relatedPaths: options.relatedPaths ?? [],
		evidence: {},
		fingerprint,
	};
}

const issues = [
	makeIssue("broken-links", "error", "broken-error"),
	makeIssue("duplicate-files", "warning", "duplicate-warning"),
	makeIssue("duplicate-files", "info", "duplicate-info"),
];

describe("report filters", () => {
	it("derives visible issues, summary, and faceted counts from active filters", () => {
		const filtered = buildIssueFilterView(issues, {
			scanner: "duplicate-files",
			severity: "error",
			status: null,
			classification: null,
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
			status: null,
			classification: null,
		});

		expect(withoutSeverity.visibleIssues.map((issue) => issue.fingerprint)).toEqual([
			"duplicate-info",
			"duplicate-warning",
		]);
	});

	it("combines lifecycle and classification filters", () => {
		const findings = [
			makeIssue("broken-links", "error", "new-confirmed", { classification: "confirmed" }),
			makeIssue("broken-links", "error", "persisting-confirmed", { classification: "confirmed" }),
			makeIssue("broken-links", "error", "new-candidate", { classification: "candidate" }),
		];
		const statuses = new Map<string, CurrentFindingStatus>([
			["new-confirmed", "new"],
			["persisting-confirmed", "persisting"],
			["new-candidate", "new"],
		]);

		const filtered = buildIssueFilterView(findings, {
			scanner: null,
			severity: null,
			status: "new",
			classification: "confirmed",
		}, statuses);

		expect(filtered.visibleIssues.map((issue) => issue.fingerprint)).toEqual([
			"new-confirmed",
		]);
	});

	it("orders confirmed new findings by severity before the remaining confidence tiers", () => {
		const findings = [
			makeIssue("broken-links", "error", "unverified-new", { classification: "unverified" }),
			makeIssue("broken-links", "error", "candidate-persisting", { classification: "candidate" }),
			makeIssue("broken-links", "info", "confirmed-new-info"),
			makeIssue("broken-links", "error", "confirmed-unknown"),
			makeIssue("broken-links", "warning", "confirmed-new-warning"),
			makeIssue("broken-links", "error", "unverified-persisting", { classification: "unverified" }),
			makeIssue("broken-links", "warning", "confirmed-persisting"),
			makeIssue("broken-links", "error", "candidate-new", { classification: "candidate" }),
			makeIssue("broken-links", "error", "confirmed-new-error"),
		];
		const statuses = new Map<string, CurrentFindingStatus>([
			["unverified-new", "new"],
			["candidate-persisting", "persisting"],
			["confirmed-new-info", "new"],
			["confirmed-new-warning", "new"],
			["unverified-persisting", "persisting"],
			["confirmed-persisting", "persisting"],
			["candidate-new", "new"],
			["confirmed-new-error", "new"],
		]);

		const filtered = buildIssueFilterView(findings, {
			scanner: null,
			severity: null,
			status: null,
			classification: null,
		}, statuses);

		expect(filtered.visibleIssues.map((issue) => issue.fingerprint)).toEqual([
			"confirmed-new-error",
			"confirmed-new-warning",
			"confirmed-new-info",
			"confirmed-persisting",
			"confirmed-unknown",
			"candidate-new",
			"candidate-persisting",
			"unverified-new",
			"unverified-persisting",
		]);
	});

	it("does not lifecycle-rank candidate or unverified findings", () => {
		const findings = [
			makeIssue("empty-notes", "error", "candidate-new-z", {
				classification: "candidate",
				primaryPath: "z.md",
			}),
			makeIssue("broken-links", "info", "candidate-persisting-a", {
				classification: "candidate",
				primaryPath: "a.md",
			}),
			makeIssue("orphan-attachments", "error", "unverified-new-z", {
				classification: "unverified",
				primaryPath: "z.png",
			}),
			makeIssue("broken-links", "info", "unverified-persisting-a", {
				classification: "unverified",
				primaryPath: "a.md",
			}),
		];
		const statuses = new Map<string, CurrentFindingStatus>([
			["candidate-new-z", "new"],
			["candidate-persisting-a", "persisting"],
			["unverified-new-z", "new"],
			["unverified-persisting-a", "persisting"],
		]);

		const filtered = buildIssueFilterView(findings, {
			scanner: null,
			severity: null,
			status: null,
			classification: null,
		}, statuses);

		expect(filtered.visibleIssues.map((issue) => issue.fingerprint)).toEqual([
			"candidate-persisting-a",
			"candidate-new-z",
			"unverified-persisting-a",
			"unverified-new-z",
		]);
	});

	it("uses scanner, path, and fingerprint as deterministic tie-breakers without mutating input", () => {
		const first = makeIssue("empty-notes", "warning", "z-fingerprint", {
			primaryPath: "same.md",
		});
		const second = makeIssue("broken-links", "warning", "z-path", {
			primaryPath: "z.md",
		});
		const third = makeIssue("broken-links", "warning", "z-fingerprint", {
			primaryPath: "same.md",
		});
		const fourth = makeIssue("broken-links", "warning", "a-fingerprint", {
			relatedPaths: ["same.md"],
		});
		const findings = [first, second, third, fourth];
		const originalOrder = [...findings];
		const statuses = new Map(findings.map((issue) => [issue.fingerprint, "persisting"] as const));

		const filtered = buildIssueFilterView(findings, {
			scanner: null,
			severity: null,
			status: null,
			classification: null,
		}, statuses);

		expect(filtered.visibleIssues.map((issue) => issue.fingerprint)).toEqual([
			"a-fingerprint",
			"z-fingerprint",
			"z-path",
			"z-fingerprint",
		]);
		expect(filtered.visibleIssues.map((issue) => issue.scannerId)).toEqual([
			"broken-links",
			"broken-links",
			"broken-links",
			"empty-notes",
		]);
		expect(findings).toEqual(originalOrder);
		expect(findings[0]).toBe(first);
	});

	it("sorts complete filter calls with lifecycle and deterministic ordering", () => {
		const candidateLaterScanner = makeIssue("empty-notes", "info", "candidate-z", {
			classification: "candidate",
			primaryPath: "z.md",
		});
		const unverified = makeIssue("broken-links", "error", "unverified-a", {
			classification: "unverified",
			primaryPath: "a.md",
		});
		const confirmedNew = makeIssue("orphan-attachments", "error", "confirmed-new", {
			primaryPath: "new.png",
		});
		const candidateEarlierScanner = makeIssue("broken-links", "info", "candidate-a", {
			classification: "candidate",
			primaryPath: "a.md",
		});
		const findings = [
			candidateLaterScanner,
			unverified,
			confirmedNew,
			candidateEarlierScanner,
		];
		const originalOrder = [...findings];
		const statuses = new Map<string, CurrentFindingStatus>([
			["candidate-z", "new"],
			["unverified-a", "persisting"],
			["confirmed-new", "new"],
			["candidate-a", "persisting"],
		]);

		const filtered = buildIssueFilterView(findings, {
			scanner: null,
			severity: null,
			status: null,
			classification: null,
		}, statuses);

		expect(filtered.visibleIssues.map((issue) => issue.fingerprint)).toEqual([
			"confirmed-new",
			"candidate-a",
			"candidate-z",
			"unverified-a",
		]);
		expect(findings).toEqual(originalOrder);
	});

	it("rejects partially migrated filter variables at compile time", () => {
		const partialFilter = {
			scanner: null,
			severity: null,
			status: "new" as const,
		};
		const compileOnly = () => {
			// @ts-expect-error status and classification must be supplied together
			buildIssueFilterView([], partialFilter);
		};

		expect(compileOnly).toBeTypeOf("function");
	});

	it("keeps findings without lifecycle status unless a lifecycle filter is active", () => {
		const finding = makeIssue("broken-links", "error", "unknown-status");

		expect(buildIssueFilterView([finding], {
			scanner: null,
			severity: null,
			status: null,
			classification: null,
		}).visibleIssues).toEqual([finding]);
		expect(buildIssueFilterView([finding], {
			scanner: null,
			severity: null,
			status: "new",
			classification: null,
		}).visibleIssues).toEqual([]);
	});

	it("computes every facet by applying only the other three filters", () => {
		const findings = [
			makeIssue("broken-links", "error", "selected", { classification: "confirmed" }),
			makeIssue("broken-links", "warning", "wrong-severity", { classification: "confirmed" }),
			makeIssue("empty-notes", "error", "wrong-scanner", { classification: "confirmed" }),
			makeIssue("broken-links", "error", "wrong-status", { classification: "confirmed" }),
			makeIssue("broken-links", "error", "wrong-classification", { classification: "candidate" }),
			makeIssue("empty-notes", "info", "everything-else", { classification: "unverified" }),
		];
		const statuses = new Map<string, CurrentFindingStatus>([
			["selected", "new"],
			["wrong-severity", "new"],
			["wrong-scanner", "new"],
			["wrong-status", "persisting"],
			["wrong-classification", "new"],
			["everything-else", "persisting"],
		]);

		const filtered = buildIssueFilterView(findings, {
			scanner: "broken-links",
			severity: "error",
			status: "new",
			classification: "confirmed",
		}, statuses);

		expect(filtered.scannerCounts).toEqual(new Map<ScannerId, number>([
			["broken-links", 1],
			["empty-notes", 1],
		]));
		expect(filtered.severityFacets).toEqual([
			{ severity: "error", count: 1 },
			{ severity: "warning", count: 1 },
		]);
		expect(filtered.statusFacets).toEqual([
			{ status: "new", count: 1 },
			{ status: "persisting", count: 1 },
		]);
		expect(filtered.classificationFacets).toEqual([
			{ classification: "confirmed", count: 1 },
			{ classification: "candidate", count: 1 },
		]);
	});

	it("retains selected zero-count facets in fixed order", () => {
		const finding = makeIssue("broken-links", "error", "only", { classification: "confirmed" });

		const filtered = buildIssueFilterView([finding], {
			scanner: "empty-notes",
			severity: "info",
			status: "persisting",
			classification: "unverified",
		}, new Map([["only", "new"]]));

		expect(filtered.severityFacets).toEqual([{ severity: "info", count: 0 }]);
		expect(filtered.statusFacets).toEqual([{ status: "persisting", count: 0 }]);
		expect(filtered.classificationFacets).toEqual([
			{ classification: "unverified", count: 0 },
		]);
	});
});
