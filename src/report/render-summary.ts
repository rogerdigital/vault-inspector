import type { ScanResult, IssueSeverity } from "../scanner/Issue";

export type SummaryActions = {
	onFilterSeverity: (severity: IssueSeverity | null) => void;
};

export function renderSummary(container: HTMLElement, result: ScanResult, actions?: SummaryActions) {
	const errors = result.issues.filter((i) => i.severity === "error").length;
	const warnings = result.issues.filter((i) => i.severity === "warning").length;
	const infos = result.issues.filter((i) => i.severity === "info").length;
	const duration = ((result.finishedAt - result.startedAt) / 1000).toFixed(1);

	const summary = container.createDiv({ cls: "vi-summary" });
	summary.createEl("h2", { text: "Scan results" });

	const stats = summary.createDiv({ cls: "vi-stats" });
	const items: Array<{ label: string; value: number; cls: string; severity: IssueSeverity | null }> = [
		{ label: "Total", value: result.issues.length, cls: "vi-stat-total", severity: null },
		{ label: "Errors", value: errors, cls: "vi-stat-error", severity: "error" },
		{ label: "Warnings", value: warnings, cls: "vi-stat-warning", severity: "warning" },
		{ label: "Info", value: infos, cls: "vi-stat-info", severity: "info" },
	];

	for (const item of items) {
		const stat = stats.createDiv({ cls: `vi-stat ${item.cls}` });
		stat.createEl("span", { cls: "vi-stat-value", text: String(item.value) });
		stat.createEl("span", { cls: "vi-stat-label", text: item.label });
		if (actions) {
			stat.addClass("vi-stat-clickable");
			stat.addEventListener("click", () => actions.onFilterSeverity(item.severity));
		}
	}

	const meta = summary.createDiv({ cls: "vi-meta" });
	meta.createEl("span", { text: `${result.filesScanned} files scanned` });
	meta.createEl("span", { text: `${duration}s` });
	meta.createEl("span", { text: `${result.scannersRun.length} scanners` });
}
