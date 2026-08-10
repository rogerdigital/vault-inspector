import type {
	Issue,
	IssueSeverity,
	ScanProgress,
	ScanResult,
	ScannerId,
} from "../scanner/Issue";
import type { LifecycleComparison } from "../scanner/result-diff";

const SEVERITIES: IssueSeverity[] = ["error", "warning", "info"];

export type IssueFilters = {
	scanner: ScannerId | null;
	severity: IssueSeverity | null;
};

export type IssueSummary = {
	total: number;
	errors: number;
	warnings: number;
	infos: number;
};

export type IssueFilterView = {
	visibleIssues: Issue[];
	scannerCounts: Map<ScannerId, number>;
	severityFacets: Array<{ severity: IssueSeverity; count: number }>;
};

export function buildIssueFilterView(issues: Issue[], filters: IssueFilters): IssueFilterView {
	const visibleIssues = issues.filter((issue) =>
		(!filters.scanner || issue.scannerId === filters.scanner)
		&& (!filters.severity || issue.severity === filters.severity),
	);

	const scannerCounts = new Map<ScannerId, number>();
	for (const issue of issues) scannerCounts.set(issue.scannerId, 0);
	for (const issue of issues) {
		if (filters.severity && issue.severity !== filters.severity) continue;
		scannerCounts.set(issue.scannerId, (scannerCounts.get(issue.scannerId) ?? 0) + 1);
	}

	const severityCounts = new Map<IssueSeverity, number>(
		SEVERITIES.map((severity) => [severity, 0]),
	);
	for (const issue of issues) {
		if (filters.scanner && issue.scannerId !== filters.scanner) continue;
		severityCounts.set(issue.severity, (severityCounts.get(issue.severity) ?? 0) + 1);
	}
	const severityFacets = SEVERITIES
		.map((severity) => ({ severity, count: severityCounts.get(severity) ?? 0 }))
		.filter(({ severity, count }) => count > 0 || filters.severity === severity);

	return {
		visibleIssues,
		scannerCounts,
		severityFacets,
	};
}

export function summarizeIssues(issues: Issue[]): IssueSummary {
	return {
		total: issues.length,
		errors: issues.filter((issue) => issue.severity === "error").length,
		warnings: issues.filter((issue) => issue.severity === "warning").length,
		infos: issues.filter((issue) => issue.severity === "info").length,
	};
}

export type ReportModel = {
	result: ScanResult | null;
	comparison: LifecycleComparison;
	isScanning: boolean;
	scanProgress: ScanProgress | null;
	scanStartedAt: number | null;
	filterScanner: ScannerId | null;
	filterSeverity: IssueSeverity | null;
	enableFixActions: boolean;
	selectionMode: boolean;
	selectedFingerprints: Set<string>;
	ignoredExpanded: boolean;
	ignoredSelectionMode: boolean;
	ignoredSelectedFingerprints: Set<string>;
};
