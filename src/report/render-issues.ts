import type { Issue, ScannerId } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import { setTooltip } from "obsidian";

export type IssueListConfig = {
	issues: Issue[];
	scannersRun: ScannerId[];
	selectionMode: boolean;
	selectedFingerprints: Set<string>;
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
			if (!config.selectionMode && getIssuePath(issue)) {
				li.addClass("vi-issue-clickable");
				setTooltip(li, "Click to open issue location");
				li.addEventListener("click", (event) => {
					if (shouldKeepTextSelection(event)) return;
					config.onOpenIssue(issue);
				});
			}

			if (config.selectionMode) {
				const checkbox = li.createEl("input", { cls: "vi-issue-checkbox", type: "checkbox" });
				checkbox.checked = isSelected;
				checkbox.addEventListener("click", (e) => { e.stopPropagation(); config.onToggleSelect(issue); });
				li.addEventListener("click", () => config.onToggleSelect(issue));
			}

			li.createEl("span", {
				cls: `vi-severity-badge vi-severity-${issue.severity}`,
				text: issue.severity.toUpperCase(),
			});
			li.createEl("span", { cls: "vi-issue-title", text: issue.title });

			const issuePath = getIssuePath(issue);
			if (issuePath) {
				const pathEl = li.createEl("span", {
					cls: "vi-issue-path",
					text: issuePath,
				});
				setTooltip(pathEl, "Click to open issue location");
				pathEl.addEventListener("click", (e) => {
					e.stopPropagation();
					if (hasActiveTextSelection()) return;
					config.onOpenIssue(issue);
				});
			}

			renderIssueDetails(li, issue);
		}
	}
}

function shouldKeepTextSelection(event: MouseEvent): boolean {
	const target = event.target instanceof HTMLElement ? event.target : null;
	if (target?.closest(".vi-issue-details")) return true;
	return hasActiveTextSelection();
}

function hasActiveTextSelection(): boolean {
	return window.getSelection()?.toString().trim().length ? true : false;
}

function renderIssueDetails(container: HTMLElement, issue: Issue) {
	const details = container.createDiv({ cls: "vi-issue-details" });
	const summary = getIssueSummary(issue);
	if (summary) details.createEl("div", { cls: "vi-issue-message", text: summary });

	for (const row of getIssueDetailRows(issue)) {
		const rowEl = details.createDiv({ cls: "vi-issue-target" });
		rowEl.createEl("span", { cls: "vi-issue-target-label", text: row.label });
		rowEl.createEl("span", { cls: "vi-issue-target-value", text: row.value });
	}
}

function getIssueSummary(issue: Issue): string {
	switch (issue.scannerId) {
		case "external-links":
			return getExternalLinkSummary(issue);
		case "large-files": {
			const size = getNumber(issue.evidence.size);
			const threshold = getNumber(issue.evidence.threshold);
			if (size !== null && threshold !== null) {
				return `File is ${formatBytes(size)}, over ${formatBytes(threshold)} threshold`;
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
			return size !== null ? `No content besides frontmatter/title · ${formatBytes(size)}` : issue.message;
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

function getIssueDetailRows(issue: Issue): Array<{ label: string; value: string }> {
	const rows: Array<{ label: string; value: string }> = [];
	const target = getIssueTarget(issue);
	if (target) rows.push({ label: getTargetLabel(issue), value: target });

	if (issue.scannerId === "duplicate-files") {
		const count = getNumber(issue.evidence.count);
		if (count !== null) rows.push({ label: "Count", value: String(count) });
		const paths = getEvidencePaths(issue);
		if (paths.length > 0) rows.push({ label: "Files", value: summarizePaths(paths) });
	}

	if (issue.scannerId === "frontmatter-types") {
		const property = issue.evidence.property;
		const types = issue.evidence.types;
		const fileCount = getNumber(issue.evidence.fileCount);
		if (typeof property === "string") rows.push({ label: "Property", value: property });
		if (typeof types === "string") rows.push({ label: "Types", value: types });
		if (fileCount !== null) rows.push({ label: "Files", value: String(fileCount) });
	}

	if (issue.scannerId === "tag-usage") {
		const tag = issue.evidence.tag;
		const count = getNumber(issue.evidence.count);
		const threshold = getNumber(issue.evidence.threshold);
		if (typeof tag === "string") rows.push({ label: "Tag", value: tag });
		if (count !== null) rows.push({ label: "Count", value: String(count) });
		if (threshold !== null) rows.push({ label: "Threshold", value: String(threshold) });
	}

	if (issue.scannerId === "large-files") {
		const type = issue.evidence.type;
		if (typeof type === "string") rows.push({ label: "Type", value: type });
	}

	return rows;
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

function summarizePaths(paths: string[]): string {
	const visible = paths.slice(0, 4);
	const suffix = paths.length > visible.length ? `, +${paths.length - visible.length} more` : "";
	return `${visible.join(", ")}${suffix}`;
}

function getNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kib = bytes / 1024;
	if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KB`;
	const mib = kib / 1024;
	return `${mib.toFixed(mib < 10 ? 1 : 0)} MB`;
}

function formatDate(timestamp: number): string {
	return new Date(timestamp).toLocaleDateString();
}

function getIssuePath(issue: Issue): string | null {
	return issue.primaryPath ?? issue.relatedPaths[0] ?? null;
}

function groupByScanner(issues: Issue[]): Record<string, Issue[]> {
	const groups: Record<string, Issue[]> = {};
	for (const issue of issues) {
		if (!groups[issue.scannerId]) groups[issue.scannerId] = [];
		groups[issue.scannerId].push(issue);
	}
	return groups;
}
