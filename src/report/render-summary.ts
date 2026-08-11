import type { ScanResult } from "../scanner/Issue";
import type {
	ComparisonUnavailableReason,
	CurrentFindingStatus,
	LifecycleComparison,
} from "../scanner/result-diff";
import { formatDuration } from "../utils/format";

export type SummaryOptions = {
	comparison: LifecycleComparison;
	onFilterStatus?: (status: CurrentFindingStatus | null) => void;
};

export function renderSummary(container: HTMLElement, result: ScanResult, options: SummaryOptions) {
	const duration = formatDuration(result.finishedAt - result.startedAt);

	const summary = container.createDiv({ cls: "vi-summary" });
	summary.createEl("h2", { text: "Scan results" });

	const stats = summary.createDiv({ cls: "vi-stats" });
	const items: Array<{
		label: string;
		value: number;
		cls: string;
		status?: CurrentFindingStatus;
	}> = [{
		label: "Active",
		value: result.issues.length,
		cls: "vi-stat-active",
	}];

	if (options.comparison.available) {
		items.push(
			{
				label: "New",
				value: countStatus(result, options.comparison, "new"),
				cls: "vi-stat-new",
				status: "new",
			},
			{
				label: "Persisting",
				value: countStatus(result, options.comparison, "persisting"),
				cls: "vi-stat-persisting",
				status: "persisting",
			},
			{
				label: "Resolved",
				value: options.comparison.resolvedIssues.filter((issue) => !issue.ignored).length,
				cls: "vi-stat-resolved",
			},
		);
	}

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

	if (!options.comparison.available) {
		summary.createDiv({
			cls: "vi-comparison-note",
			text: unavailableMessage(options.comparison.reason ?? "first-scan"),
		});
	}

	const meta = summary.createDiv({ cls: "vi-meta" });
	meta.createSpan({ text: `${result.filesScanned} files scanned` });
	meta.createSpan({ text: duration });
	meta.createSpan({ text: `${result.scannersRun.length} scanners` });
	meta.createSpan({ text: `Ignored ${result.ignoredIssues.length}` });
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

function unavailableMessage(reason: ComparisonUnavailableReason): string {
	if (reason === "settings-changed") {
		return "Scan settings changed; this scan starts a new comparison baseline";
	}
	if (reason === "semantics-changed") {
		return "Scanner behavior changed; this scan starts a new comparison baseline";
	}
	return "No previous successful scan for these settings";
}
