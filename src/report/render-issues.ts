import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import type { ReportModel } from "./report-model";
import { setIcon } from "obsidian";

type IssueActions = {
	onOpenFile: (path: string) => void;
	onCopyPath: (path: string) => void;
	onIgnore: (issue: Issue) => void;
};

export function renderIssues(
	container: HTMLElement,
	result: ScanResult,
	model: ReportModel,
	actions: IssueActions,
) {
	let issues = result.issues;
	if (model.filterSeverity) issues = issues.filter((i) => i.severity === model.filterSeverity);
	if (model.filterScanner) issues = issues.filter((i) => i.scannerId === model.filterScanner);

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
			const li = list.createEl("li", { cls: `vi-issue vi-severity-${issue.severity}` });
			li.createEl("span", {
				cls: `vi-severity-badge vi-severity-${issue.severity}`,
				text: issue.severity.toUpperCase(),
			});
			li.createEl("span", { cls: "vi-issue-title", text: issue.title });

			if (issue.primaryPath) {
				const pathEl = li.createEl("span", { cls: "vi-issue-path", text: issue.primaryPath });
				pathEl.addEventListener("click", (e) => { e.stopPropagation(); actions.onOpenFile(issue.primaryPath!); });
				pathEl.addEventListener("contextmenu", (e) => { e.preventDefault(); actions.onCopyPath(issue.primaryPath!); });
				const copyBtn = li.createEl("button", { cls: "vi-copy-btn", attr: { "aria-label": "Copy path" } });
				setIcon(copyBtn, "copy");
				copyBtn.addEventListener("click", (e) => { e.stopPropagation(); actions.onCopyPath(issue.primaryPath!); });
			}

			li.createEl("div", { cls: "vi-issue-message", text: issue.message });
			li.createEl("button", { cls: "vi-ignore-btn", text: "Ignore" })
				.addEventListener("click", (e) => { e.stopPropagation(); actions.onIgnore(issue); });
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
