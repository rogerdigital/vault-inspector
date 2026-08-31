import type { ScanResult } from "../scanner/Issue";
import type {
	ComparisonUnavailableReason,
	CurrentFindingStatus,
	LifecycleComparison,
} from "../scanner/result-diff";
import { countNewConfirmedFindings } from "./report-model";
import { formatDuration } from "../utils/format";

export type SummaryOptions = {
	comparison: LifecycleComparison;
	onFilterStatus?: (status: CurrentFindingStatus | null) => void;
	onReviewNewFindings?: () => void;
};

export function renderSummary(container: HTMLElement, result: ScanResult, options: SummaryOptions) {
	const duration = formatDuration(result.finishedAt - result.startedAt);

	const summary = container.createDiv({ cls: "vi-summary" });
	summary.createEl("h2", { text: "Scan results" });

	renderChanges(summary, result, options);

	const stats = summary.createDiv({ cls: "vi-stats" });
	const active = stats.createDiv({ cls: "vi-stat vi-stat-active" });
	active.createSpan({ cls: "vi-stat-label", text: "Active" });
	active.createSpan({ cls: "vi-stat-value", text: String(result.issues.length) });

	const meta = summary.createDiv({ cls: "vi-meta" });
	meta.createSpan({ text: `${result.filesScanned} files scanned` });
	meta.createSpan({ text: duration });
	meta.createSpan({ text: `${result.scannersRun.length} scanners` });
	meta.createSpan({ text: `Ignored ${result.ignoredIssues.length}` });
}

function renderChanges(
	summary: HTMLElement,
	result: ScanResult,
	options: SummaryOptions,
): void {
	const comparison = options.comparison;
	const changes = summary.createDiv({ cls: "vi-changes" });
	changes.createDiv({ cls: "vi-changes-title", text: "What changed" });

	if (!comparison.available) {
		changes.createDiv({
			cls: "vi-comparison-note",
			text: unavailableMessage(
				comparison.reason ?? "first-scan",
				comparison.previousScanAt,
			),
		});
		return;
	}

	changes.createDiv({
		cls: "vi-changes-meta",
		text: comparison.previousScanAt === undefined
			? "Compared with the previous successful scan"
			: `Compared with the scan from ${formatScanTime(comparison.previousScanAt)}`,
	});

	const newConfirmed = countNewConfirmedFindings(result.issues, comparison.statuses);
	const stats = changes.createDiv({ cls: "vi-changes-stats" });
	const items: Array<{
		label: string;
		value: number;
		cls: string;
		status?: CurrentFindingStatus;
	}> = [
		{ label: "New errors", value: newConfirmed.errors, cls: "vi-stat-new vi-stat-error" },
		{ label: "New warnings", value: newConfirmed.warnings, cls: "vi-stat-new vi-stat-warning" },
		{
			label: "Persisting",
			value: countStatus(result, comparison, "persisting"),
			cls: "vi-stat-persisting",
			status: "persisting",
		},
		{
			label: "Resolved",
			value: comparison.resolvedIssues.filter((issue) => !issue.ignored).length,
			cls: "vi-stat-resolved",
		},
	];
	for (const item of items) {
		const status = item.status;
		const onFilterStatus = options.onFilterStatus;
		const isFilter = status !== undefined && onFilterStatus !== undefined;
		const cls = `vi-stat ${item.cls}${isFilter ? " vi-stat-clickable" : ""}`;
		const stat = isFilter
			? stats.createEl("button", { cls, attr: { type: "button" } })
			: stats.createDiv({ cls });
		stat.createSpan({ cls: "vi-stat-label", text: item.label });
		stat.createSpan({ cls: "vi-stat-value", text: String(item.value) });
		if (status !== undefined && onFilterStatus) {
			stat.addEventListener("click", () => onFilterStatus(status));
		}
	}

	const reviewable = newConfirmed.errors + newConfirmed.warnings;
	const onReviewNewFindings = options.onReviewNewFindings;
	if (reviewable > 0 && onReviewNewFindings) {
		const button = changes.createEl("button", {
			cls: "vi-review-new-btn",
			text: `Review new findings (${reviewable})`,
			attr: { type: "button" },
		});
		button.addEventListener("click", () => onReviewNewFindings());
	}
}

function countStatus(
	result: ScanResult,
	comparison: LifecycleComparison,
	status: CurrentFindingStatus,
): number {
	return result.issues.filter(
		(issue) => comparison.statuses.get(issue.fingerprint) === status,
	).length;
}

function unavailableMessage(
	reason: ComparisonUnavailableReason,
	previousScanAt?: number,
): string {
	const base = baseUnavailableMessage(reason);
	if (previousScanAt === undefined) return base;
	return `${base} (previous successful scan: ${formatScanTime(previousScanAt)})`;
}

function baseUnavailableMessage(reason: ComparisonUnavailableReason): string {
	if (reason === "settings-changed") {
		return "Scan settings changed; this scan starts a new comparison baseline";
	}
	if (reason === "semantics-changed") {
		return "Scanner behavior changed; this scan starts a new comparison baseline";
	}
	return "No previous successful scan for these settings";
}

function formatScanTime(ms: number): string {
	return new Date(ms).toLocaleString();
}
