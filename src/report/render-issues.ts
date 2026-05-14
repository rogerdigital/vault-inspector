import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import type { ReportModel } from "./report-model";
import { setIcon } from "obsidian";

type IssueActions = {
	onOpenFile: (path: string) => void;
	onCopyPath: (path: string) => void;
	onIgnore: (issue: Issue) => void;
	onFix: (issue: Issue) => void;
	onFixAll: (issues: Issue[]) => void;
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

		const headerRow = section.createDiv({ cls: "vi-scanner-header-row" });
		headerRow.createEl("h3", {
			cls: "vi-scanner-header",
			text: `${SCANNER_LABELS[scannerId]} (${scannerIssues.length})`,
		});

		const fixableIssues = scannerIssues.filter(
			(i) => i.fixAction && !ignoredFingerprints.has(i.fingerprint),
		);
		if (model.enableFixActions && fixableIssues.length > 1) {
			const batchBtn = headerRow.createEl("button", {
				cls: "vi-fix-all-btn",
				text: `Clean all (${fixableIssues.length})`,
			});
			setIcon(batchBtn, "trash-2");
			batchBtn.addEventListener("click", () => actions.onFixAll(fixableIssues));
		}

		if (scannerIssues.length === 0) {
			section.createEl("div", { cls: "vi-no-issues", text: "No issues found." });
			continue;
		}

		const list = section.createEl("ul", { cls: "vi-issue-list" });
		for (const issue of scannerIssues) {
			const isIgnored = ignoredFingerprints.has(issue.fingerprint);
			const cls = `vi-issue vi-severity-${issue.severity}${isIgnored ? " vi-ignored" : ""}`;
			const li = list.createEl("li", { cls });
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

			if (model.enableFixActions && issue.fixAction && !isIgnored) {
				const fixBtn = li.createEl("button", { cls: "vi-fix-btn", text: issue.fixAction.label });
				setIcon(fixBtn, issue.fixAction.kind === "trash-file" ? "trash-2" : "eraser");
				fixBtn.addEventListener("click", (e) => { e.stopPropagation(); actions.onFix(issue); });
			}

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
