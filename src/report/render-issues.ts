import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";

export function renderIssues(
	container: HTMLElement,
	result: ScanResult,
) {
	const grouped = groupByScanner(result.issues);
	const scannerOrder = result.scannersRun;

	for (const scannerId of scannerOrder) {
		const issues = grouped[scannerId] ?? [];
		const section = container.createDiv({ cls: "vi-scanner-section" });
		section.createEl("h3", {
			cls: "vi-scanner-header",
			text: `${SCANNER_LABELS[scannerId]} (${issues.length})`,
		});

		if (issues.length === 0) {
			section.createEl("div", { cls: "vi-no-issues", text: "No issues found." });
			continue;
		}

		const list = section.createEl("ul", { cls: "vi-issue-list" });
		for (const issue of issues) {
			const li = list.createEl("li", {
				cls: `vi-issue vi-severity-${issue.severity}`,
			});
			li.createEl("span", {
				cls: `vi-severity-badge vi-severity-${issue.severity}`,
				text: issue.severity.toUpperCase(),
			});
			li.createEl("span", { cls: "vi-issue-title", text: issue.title });

			if (issue.primaryPath) {
				li.createEl("span", {
					cls: "vi-issue-path",
					text: issue.primaryPath,
				});
			}

			li.createEl("div", {
				cls: "vi-issue-message",
				text: issue.message,
			});
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
