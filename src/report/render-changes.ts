import { SCANNER_LABELS } from "../scanner/Issue";
import type { SnapshotIssue } from "../snapshot/scan-snapshot";

export function renderResolvedChanges(
	container: HTMLElement,
	issues: SnapshotIssue[],
): void {
	for (const issue of issues) {
		const item = container.createDiv({ cls: "vi-resolved-item" });
		item.createSpan({
			cls: "vi-status-badge vi-status-resolved",
			text: "RESOLVED",
		});
		item.createSpan({
			cls: "vi-resolved-scanner",
			text: SCANNER_LABELS[issue.scannerId],
		});
		item.createSpan({ cls: "vi-resolved-title", text: issue.title });
		if (issue.primaryPath) {
			item.createSpan({ cls: "vi-issue-path", text: issue.primaryPath });
		}
		if (issue.ignored) {
			item.createSpan({
				cls: "vi-resolved-ignored",
				text: "Previously ignored",
			});
		}
	}
}
