import type {
	FindingClassification,
	Issue,
	IssueSeverity,
	ScanProgress,
	ScanResult,
	ScannerId,
} from "../scanner/Issue";
import { SCANNER_IDS } from "../scanner/Issue";
import type {
	CurrentFindingStatus,
	LifecycleComparison,
} from "../scanner/result-diff";
import type { OperationOutcome } from "../fix/action-outcomes";

const SEVERITIES: IssueSeverity[] = ["error", "warning", "info"];
const STATUSES: CurrentFindingStatus[] = ["new", "persisting"];
const CLASSIFICATIONS: FindingClassification[] = ["confirmed", "candidate", "unverified"];
const SCANNER_RANK = new Map(SCANNER_IDS.map((scannerId, index) => [scannerId, index]));

export type IssueFilters = {
	scanner: ScannerId | null;
	severity: IssueSeverity | null;
	status: CurrentFindingStatus | null;
	classification: FindingClassification | null;
};

export type IssueFilterView = {
	visibleIssues: Issue[];
	scannerCounts: Map<ScannerId, number>;
	severityFacets: Array<{ severity: IssueSeverity; count: number }>;
	statusFacets: Array<{ status: CurrentFindingStatus; count: number }>;
	classificationFacets: Array<{ classification: FindingClassification; count: number }>;
};

export function buildIssueFilterView(
	issues: Issue[],
	filters: IssueFilters,
	statuses: ReadonlyMap<string, CurrentFindingStatus> = new Map(),
): IssueFilterView {
	const statusFilter = filters.status;
	const classificationFilter = filters.classification;
	const matchesScanner = (issue: Issue) =>
		!filters.scanner || issue.scannerId === filters.scanner;
	const matchesSeverity = (issue: Issue) =>
		!filters.severity || issue.severity === filters.severity;
	const matchesStatus = (issue: Issue) =>
		!statusFilter || statuses.get(issue.fingerprint) === statusFilter;
	const matchesClassification = (issue: Issue) =>
		!classificationFilter || issue.classification === classificationFilter;

	const matchingIssues = issues.filter((issue) =>
		matchesScanner(issue)
		&& matchesSeverity(issue)
		&& matchesStatus(issue)
		&& matchesClassification(issue),
	);
	const visibleIssues = matchingIssues.sort((left, right) =>
		compareIssues(left, right, statuses),
	);

	const scannerCounts = new Map<ScannerId, number>();
	for (const issue of issues) scannerCounts.set(issue.scannerId, 0);
	for (const issue of issues) {
		if (!matchesSeverity(issue) || !matchesStatus(issue) || !matchesClassification(issue)) continue;
		scannerCounts.set(issue.scannerId, (scannerCounts.get(issue.scannerId) ?? 0) + 1);
	}

	const severityCounts = new Map<IssueSeverity, number>(
		SEVERITIES.map((severity) => [severity, 0]),
	);
	for (const issue of issues) {
		if (!matchesScanner(issue) || !matchesStatus(issue) || !matchesClassification(issue)) continue;
		severityCounts.set(issue.severity, (severityCounts.get(issue.severity) ?? 0) + 1);
	}
	const severityFacets = SEVERITIES
		.map((severity) => ({ severity, count: severityCounts.get(severity) ?? 0 }))
		.filter(({ severity, count }) => count > 0 || filters.severity === severity);

	const statusCounts = new Map<CurrentFindingStatus, number>(
		STATUSES.map((status) => [status, 0]),
	);
	for (const issue of issues) {
		if (!matchesScanner(issue) || !matchesSeverity(issue) || !matchesClassification(issue)) continue;
		const status = statuses.get(issue.fingerprint);
		if (status) statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
	}
	const statusFacets = STATUSES
		.map((status) => ({ status, count: statusCounts.get(status) ?? 0 }))
		.filter(({ status, count }) => count > 0 || statusFilter === status);

	const classificationCounts = new Map<FindingClassification, number>(
		CLASSIFICATIONS.map((classification) => [classification, 0]),
	);
	for (const issue of issues) {
		if (!matchesScanner(issue) || !matchesSeverity(issue) || !matchesStatus(issue)) continue;
		classificationCounts.set(
			issue.classification,
			(classificationCounts.get(issue.classification) ?? 0) + 1,
		);
	}
	const classificationFacets = CLASSIFICATIONS
		.map((classification) => ({
			classification,
			count: classificationCounts.get(classification) ?? 0,
		}))
		.filter(({ classification, count }) =>
			count > 0 || classificationFilter === classification,
		);

	return {
		visibleIssues,
		scannerCounts,
		severityFacets,
		statusFacets,
		classificationFacets,
	};
}

function compareIssues(
	left: Issue,
	right: Issue,
	statuses: ReadonlyMap<string, CurrentFindingStatus>,
): number {
	const rankDifference = issueRank(left, statuses) - issueRank(right, statuses);
	if (rankDifference !== 0) return rankDifference;

	const scannerDifference = (SCANNER_RANK.get(left.scannerId) ?? SCANNER_IDS.length)
		- (SCANNER_RANK.get(right.scannerId) ?? SCANNER_IDS.length);
	if (scannerDifference !== 0) return scannerDifference;

	const pathDifference = compareStrings(issuePath(left), issuePath(right));
	if (pathDifference !== 0) return pathDifference;

	return compareStrings(left.fingerprint, right.fingerprint);
}

function issueRank(
	issue: Issue,
	statuses: ReadonlyMap<string, CurrentFindingStatus>,
): number {
	if (issue.classification === "candidate") return 4;
	if (issue.classification === "unverified") return 5;
	if (statuses.get(issue.fingerprint) !== "new") return 3;
	return SEVERITIES.indexOf(issue.severity);
}

function issuePath(issue: Issue): string {
	return issue.primaryPath ?? issue.relatedPaths[0] ?? "";
}

function compareStrings(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export type ReportModel = {
	result: ScanResult | null;
	comparison: LifecycleComparison;
	isScanning: boolean;
	scanProgress: ScanProgress | null;
	scanStartedAt: number | null;
	filterScanner: ScannerId | null;
	filterSeverity: IssueSeverity | null;
	filterStatus: CurrentFindingStatus | null;
	filterClassification: FindingClassification | null;
	enableFixActions: boolean;
	selectionMode: boolean;
	selectedFingerprints: Set<string>;
	ignoredExpanded: boolean;
	resolvedExpanded: boolean;
	ignoredSelectionMode: boolean;
	ignoredSelectedFingerprints: Set<string>;
	operationOutcomes: OperationOutcome[];
};
