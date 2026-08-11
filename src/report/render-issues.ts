import type { Issue, ScannerId } from "../scanner/Issue";
import type { CurrentFindingStatus } from "../scanner/result-diff";
import { SCANNER_LABELS } from "../scanner/Issue";
import { formatSize } from "../utils/format";
import { renderFindingEvidence } from "./render-evidence";
import { setTooltip } from "obsidian";

export type IssueListConfig = {
	issues: Issue[];
	scannersRun: ScannerId[];
	selectionMode: boolean;
	selectedFingerprints: Set<string>;
	statuses?: ReadonlyMap<string, CurrentFindingStatus>;
	onOpenIssue: (issue: Issue) => void;
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
				checkbox.checked = isSelected;
				checkbox.addEventListener("click", (e) => { e.stopPropagation(); config.onToggleSelect(issue); });
				li.addEventListener("click", () => config.onToggleSelect(issue));
			}

			li.createSpan({
				cls: `vi-severity-badge vi-severity-${issue.severity}`,
				text: issue.severity.toUpperCase(),
			});
			const status = config.statuses?.get(issue.fingerprint);
			if (status) {
				li.createSpan({
					cls: `vi-status-badge vi-status-${status}`,
					text: status.toUpperCase(),
				});
			}
			li.createSpan({ cls: "vi-issue-title", text: issue.title });

			const issuePath = getIssuePath(issue);
			if (issuePath) {
				const pathEl = li.createSpan({
					cls: "vi-issue-path",
					text: issuePath,
				});
				setTooltip(pathEl, "Click to open issue location");
				pathEl.addEventListener("click", (e) => {
					e.stopPropagation();
					if (hasActiveTextSelection()) return;
					config.onOpenIssue(makePathIssue(issue, issuePath));
				});
			}

			renderIssueDetails(li, issue, config);
		}
	}
}

function hasActiveTextSelection(): boolean {
	return window.getSelection()?.toString().trim().length ? true : false;
}

function renderIssueDetails(container: HTMLElement, issue: Issue, config: IssueListConfig) {
	const details = container.createDiv({ cls: "vi-issue-details" });
	const summary = getIssueSummary(issue);
	if (summary) details.createDiv({ cls: "vi-issue-message", text: summary });

	for (const row of getIssueDetailRows(issue)) {
		const rowEl = details.createDiv({ cls: "vi-issue-target" });
		rowEl.createSpan({ cls: "vi-issue-target-label", text: row.label });
		const valueEl = rowEl.createSpan({ cls: "vi-issue-target-value" });
		if ("value" in row) {
			valueEl.setText(row.value);
		} else {
			for (const item of row.items) {
				const itemEl = valueEl.createSpan({
					cls: `vi-issue-value-token ${item.className ?? ""}`.trim(),
					text: item.text,
				});
				if (!item.issue) continue;
				itemEl.addClass("vi-issue-value-clickable");
				setTooltip(itemEl, "Click to open issue location");
				itemEl.addEventListener("click", (event) => {
					event.stopPropagation();
					if (hasActiveTextSelection()) return;
					config.onOpenIssue(item.issue!);
				});
			}
		}
	}

	renderFindingEvidence(details, issue);
}

function getIssueSummary(issue: Issue): string {
	switch (issue.scannerId) {
		case "external-links":
			return getExternalLinkSummary(issue);
		case "large-files": {
			const size = getNumber(issue.evidence.size);
			const threshold = getNumber(issue.evidence.threshold);
			if (size !== null && threshold !== null) {
				return `File is ${formatSize(size)}, over ${formatSize(threshold)} threshold`;
			}
			return issue.message;
		}
		case "orphan-attachments": {
			const lastModified = getNumber(issue.evidence.lastModified);
			return lastModified !== null
				? `Not referenced by any note · modified ${formatDate(lastModified)}`
				: issue.message;
		}
		case "empty-notes": {
			const size = getNumber(issue.evidence.size);
			return size !== null ? `No content besides frontmatter/title · ${formatSize(size)}` : issue.message;
		}
		default:
			return issue.message;
	}
}

function getExternalLinkSummary(issue: Issue): string {
	if (issue.title === "External link check timed out") {
		const timeoutMs = getNumber(issue.evidence.timeoutMs);
		return timeoutMs !== null ? `Timed out after ${timeoutMs}ms` : "Timed out";
	}
	if (issue.title === "External link check failed") {
		const error = issue.evidence.error;
		return typeof error === "string" && error.length > 0
			? `Request failed: ${error}`
			: "Request failed";
	}
	if (issue.title === "Dead external link") {
		const status = getNumber(issue.evidence.status);
		return status !== null ? `HTTP ${status}` : "HTTP error";
	}
	return issue.message;
}

type IssueDetailRow =
	| { label: string; value: string }
	| { label: string; items: Array<{ text: string; issue?: Issue; className?: string }> };

function getIssueDetailRows(issue: Issue): IssueDetailRow[] {
	const rows: IssueDetailRow[] = [];
	const target = getIssueTarget(issue);
	if (target) {
		rows.push({
			label: getTargetLabel(issue),
			items: [{
				text: target,
				issue: makeTargetIssue(issue, target),
				className: "vi-issue-token-monospace",
			}],
		});
	}

	if (issue.scannerId === "duplicate-files") {
		const count = getNumber(issue.evidence.count);
		if (count !== null) rows.push({ label: "Count", value: String(count) });
		const paths = getEvidencePaths(issue);
		if (paths.length > 0) {
			rows.push({
				label: "Files",
				items: paths.map((path) => ({
					text: path,
					issue: makePathIssue(issue, path),
					className: "vi-issue-path-token",
				})),
			});
		}
	}

	if (issue.scannerId === "frontmatter-types") {
		const property = issue.evidence.property;
		const types = issue.evidence.types;
		const fileCount = getNumber(issue.evidence.fileCount);
		if (typeof property === "string") {
			rows.push({
				label: "Property",
				items: [{
					text: property,
					issue: issue.relatedPaths.length > 0 ? makePropertyIssue(issue, property) : undefined,
					className: "vi-issue-token-monospace",
				}],
			});
		}
		if (typeof types === "string") rows.push({ label: "Types", value: types });
		if (fileCount !== null) rows.push({ label: "Files", value: String(fileCount) });
		if (issue.relatedPaths.length > 0) {
			rows.push({
				label: "Sample",
				items: issue.relatedPaths.map((path) => ({
					text: path,
					issue: makePathIssue(issue, path),
					className: "vi-issue-path-token",
				})),
			});
		}
	}

	if (issue.scannerId === "tag-usage") {
		const tag = issue.evidence.tag;
		const count = getNumber(issue.evidence.count);
		const threshold = getNumber(issue.evidence.threshold);
		if (typeof tag === "string") {
			rows.push({
				label: "Tag",
				items: [{
					text: formatTag(tag),
					issue: issue.primaryPath ? makeTagIssue(issue, tag) : undefined,
					className: "vi-issue-tag-token",
				}],
			});
		}
		if (count !== null) rows.push({ label: "Count", value: String(count) });
		if (threshold !== null) rows.push({ label: "Threshold", value: String(threshold) });
	}

	if (issue.scannerId === "large-files") {
		const type = issue.evidence.type;
		if (typeof type === "string") rows.push({ label: "Type", value: type });
	}

	return rows;
}

function makePathIssue(issue: Issue, path: string): Issue {
	return {
		...issue,
		primaryPath: path,
		relatedPaths: issue.relatedPaths.filter((relatedPath) => relatedPath !== path),
	};
}

function makeTargetIssue(issue: Issue, target: string): Issue {
	const evidence = { ...issue.evidence };
	if (issue.scannerId === "external-links") {
		evidence.url = target;
	} else if (issue.scannerId === "broken-links") {
		evidence.target = target;
	} else {
		evidence.link = target;
	}

	return {
		...issue,
		evidence,
	};
}

function makeTagIssue(issue: Issue, tag: string): Issue {
	return {
		...issue,
		evidence: {
			...issue.evidence,
			tag,
		},
	};
}

function makePropertyIssue(issue: Issue, property: string): Issue {
	return {
		...issue,
		primaryPath: issue.primaryPath ?? issue.relatedPaths[0],
		evidence: {
			...issue.evidence,
			property,
		},
	};
}

export function getIssueTarget(issue: Issue): string | null {
	const url = issue.evidence.url;
	if (typeof url === "string") return url;
	const link = issue.evidence.link;
	if (typeof link === "string") return link;
	const target = issue.evidence.target;
	if (typeof target === "string") return target;
	return null;
}

function getTargetLabel(issue: Issue): string {
	if (issue.scannerId === "external-links") return "URL";
	if (issue.scannerId === "broken-links") return "Target";
	return "Target";
}

function getEvidencePaths(issue: Issue): string[] {
	const paths = issue.evidence.paths;
	if (typeof paths !== "string") return issue.relatedPaths;
	return paths.split(",").map((path) => path.trim()).filter(Boolean);
}

function getNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString();
}

function getIssuePath(issue: Issue): string | null {
	return issue.primaryPath ?? issue.relatedPaths[0] ?? null;
}

function formatTag(tag: string): string {
	return tag.startsWith("#") ? tag : `#${tag}`;
}

function groupByScanner(issues: Issue[]): Record<string, Issue[]> {
	const groups: Record<string, Issue[]> = {};
	for (const issue of issues) {
		if (!groups[issue.scannerId]) groups[issue.scannerId] = [];
		groups[issue.scannerId].push(issue);
	}
	return groups;
}
