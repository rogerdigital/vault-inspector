import type { Issue, ScannerId } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import { setTooltip } from "obsidian";

export type IssueListConfig = {
	issues: Issue[];
	scannersRun: ScannerId[];
	selectionMode: boolean;
	selectedFingerprints: Set<string>;
	onOpenFile: (path: string) => void;
	onCopyPath: (path: string) => void;
	onToggleSelect: (issue: Issue) => void;
};

export function renderIssueList(container: HTMLElement, config: IssueListConfig) {
	const grouped = groupByScanner(config.issues);

	for (const scannerId of config.scannersRun) {
		const scannerIssues = grouped[scannerId] ?? [];
		if (scannerIssues.length === 0) continue;

		const section = container.createDiv({ cls: "vi-scanner-section" });
		section.createEl("h3", {
			cls: "vi-scanner-header",
			text: `${SCANNER_LABELS[scannerId]} (${scannerIssues.length})`,
		});

		const list = section.createEl("ul", { cls: "vi-issue-list" });
		for (const issue of scannerIssues) {
			const isSelected = config.selectedFingerprints.has(issue.fingerprint);
			const cls = [
				"vi-issue",
				`vi-severity-${issue.severity}`,
				config.selectionMode ? "vi-selectable" : "",
				isSelected ? "vi-selected" : "",
			].filter(Boolean).join(" ");

			const li = list.createEl("li", { cls });

			if (config.selectionMode) {
				const checkbox = li.createEl("input", { cls: "vi-issue-checkbox", type: "checkbox" });
				(checkbox as HTMLInputElement).checked = isSelected;
				checkbox.addEventListener("click", (e) => { e.stopPropagation(); config.onToggleSelect(issue); });
				li.addEventListener("click", () => config.onToggleSelect(issue));
			}

			li.createEl("span", {
				cls: `vi-severity-badge vi-severity-${issue.severity}`,
				text: issue.severity.toUpperCase(),
			});
			li.createEl("span", { cls: "vi-issue-title", text: issue.title });

			if (issue.primaryPath) {
				const pathEl = li.createEl("span", {
					cls: "vi-issue-path",
					text: issue.primaryPath,
				});
				setTooltip(pathEl, "Click to open, right-click to copy");
				pathEl.addEventListener("click", (e) => { e.stopPropagation(); config.onOpenFile(issue.primaryPath!); });
				pathEl.addEventListener("contextmenu", (e) => { e.preventDefault(); config.onCopyPath(issue.primaryPath!); });
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
