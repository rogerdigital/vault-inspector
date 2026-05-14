import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import type { ReportModel } from "./report-model";

type IssueActions = {
	onOpenFile: (path: string) => void;
	onCopyPath: (path: string) => void;
	onToggleSelect: (issue: Issue) => void;
};

export function renderIssues(
	container: HTMLElement,
	result: ScanResult,
	model: ReportModel,
	actions: IssueActions,
) {
	let issues = result.issues;
	if (model.showIgnored) issues = [...issues, ...result.ignoredIssues];
	if (model.filterSeverity) issues = issues.filter((i) => i.severity === model.filterSeverity);
	if (model.filterScanner) issues = issues.filter((i) => i.scannerId === model.filterScanner);

	const ignoredFingerprints = new Set(result.ignoredIssues.map((i) => i.fingerprint));

	const grouped = groupByScanner(issues);
	for (const scannerId of result.scannersRun) {
		const scannerIssues = grouped[scannerId] ?? [];
		const section = container.createDiv({ cls: "vi-scanner-section" });

		section.createEl("h3", {
			cls: "vi-scanner-header",
			text: `${SCANNER_LABELS[scannerId]} (${scannerIssues.length})`,
		});

		if (scannerIssues.length === 0) {
			section.createEl("div", { cls: "vi-no-issues", text: "No issues found." });
			continue;
		}

		const list = section.createEl("ul", { cls: "vi-issue-list" });
		for (const issue of scannerIssues) {
			const isIgnored = ignoredFingerprints.has(issue.fingerprint);
			const isSelected = model.selectedFingerprints.has(issue.fingerprint);
			const cls = [
				"vi-issue",
				`vi-severity-${issue.severity}`,
				isIgnored ? "vi-ignored" : "",
				model.selectionMode ? "vi-selectable" : "",
				isSelected ? "vi-selected" : "",
			].filter(Boolean).join(" ");

			const li = list.createEl("li", { cls });

			if (model.selectionMode) {
				const checkbox = li.createEl("input", { cls: "vi-issue-checkbox", type: "checkbox" });
				(checkbox as HTMLInputElement).checked = isSelected;
				checkbox.addEventListener("click", (e) => { e.stopPropagation(); actions.onToggleSelect(issue); });
				li.addEventListener("click", () => actions.onToggleSelect(issue));
			}

			li.createEl("span", {
				cls: `vi-severity-badge vi-severity-${issue.severity}`,
				text: issue.severity.toUpperCase(),
			});
			li.createEl("span", { cls: "vi-issue-title", text: issue.title });

			if (issue.primaryPath) {
				const pathEl = li.createEl("span", { cls: "vi-issue-path", text: issue.primaryPath, attr: { "data-tooltip": "Click to open, right-click to copy" } });
				pathEl.addEventListener("click", (e) => { e.stopPropagation(); actions.onOpenFile(issue.primaryPath!); });
				pathEl.addEventListener("contextmenu", (e) => { e.preventDefault(); actions.onCopyPath(issue.primaryPath!); });
			}

			li.createEl("div", { cls: "vi-issue-message", text: issue.message });
		}
	}
}

function groupByScanner(issues: Issue[]): Record<string, Issue[]> {
	const groups: Record<string, Issue[]> = {};
	for (const issue of issues) {
		if (!groups[issue.scannerId]) groups[issue.scannerId] = [];
		groups[issue.scannerId].push(issue);
	}
	return groups;
}
