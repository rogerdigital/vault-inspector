import type { Issue, ScanResult, IssueSeverity } from "../scanner/Issue";
import { formatDuration } from "../utils/format";
import { summarizeIssues } from "./report-model";

export type SummaryOptions = {
	issues: Issue[];
	onFilterSeverity?: (severity: IssueSeverity | null) => void;
};

export function renderSummary(container: HTMLElement, result: ScanResult, options: SummaryOptions) {
	const { total, errors, warnings, infos } = summarizeIssues(options.issues);
	const duration = formatDuration(result.finishedAt - result.startedAt);

	const summary = container.createDiv({ cls: "vi-summary" });
	summary.createEl("h2", { text: "Scan results" });

	const stats = summary.createDiv({ cls: "vi-stats" });
	const items: Array<{ label: string; value: number; cls: string; severity: IssueSeverity | null }> = [
		{ label: "Total", value: total, cls: "vi-stat-total", severity: null },
		{ label: "Errors", value: errors, cls: "vi-stat-error", severity: "error" },
		{ label: "Warnings", value: warnings, cls: "vi-stat-warning", severity: "warning" },
		{ label: "Info", value: infos, cls: "vi-stat-info", severity: "info" },
	];

	for (const item of items) {
		const stat = stats.createDiv({ cls: `vi-stat ${item.cls}` });
		stat.createEl("span", { cls: "vi-stat-value", text: String(item.value) });
		stat.createEl("span", { cls: "vi-stat-label", text: item.label });
		if (options.onFilterSeverity) {
			stat.addClass("vi-stat-clickable");
			stat.addEventListener("click", () => options.onFilterSeverity?.(item.severity));
		}
	}

	const meta = summary.createDiv({ cls: "vi-meta" });
	meta.createEl("span", { text: `${result.filesScanned} files scanned` });
	meta.createEl("span", { text: duration });
	meta.createEl("span", { text: `${result.scannersRun.length} scanners` });
}
