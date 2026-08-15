import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import { formatDuration, formatSize } from "../utils/format";

export type MarkdownReportMode = "full" | "summary";

export function generateMarkdownReport(
	result: ScanResult,
	mode: MarkdownReportMode = "full",
): string {
	const lines: string[] = [];
	const now = new Date();

	lines.push(mode === "summary" ? "# Vault Inspector Summary" : "# Vault Inspector Report");
	lines.push(``);
	lines.push(`- **Date:** ${now.toLocaleString()}`);
	lines.push(`- **Files scanned:** ${result.filesScanned}`);
	lines.push(`- **Duration:** ${formatDuration(result.finishedAt - result.startedAt)}`);
	lines.push(`- **Scanners run:** ${result.scannersRun.length}`);
	lines.push(``);

	const errors = result.issues.filter((i) => i.severity === "error").length;
	const warnings = result.issues.filter((i) => i.severity === "warning").length;
	const infos = result.issues.filter((i) => i.severity === "info").length;

	lines.push(`## Summary`);
	lines.push(``);
	lines.push(`| Severity | Count |`);
	lines.push(`|---|---|`);
	lines.push(`| Total | ${result.issues.length} |`);
	lines.push(`| Errors | ${errors} |`);
	lines.push(`| Warnings | ${warnings} |`);
	lines.push(`| Info | ${infos} |`);
	lines.push(``);

	const grouped = groupByScanner(result.issues);
	if (mode === "summary") {
		lines.push("Finding details are omitted from this summary.");
		lines.push(``);
		lines.push("## Findings by scanner");
		lines.push(``);
		lines.push("| Scanner | Findings |");
		lines.push("|---|---|");
		for (const scannerId of result.scannersRun) {
			lines.push(`| ${SCANNER_LABELS[scannerId]} | ${(grouped[scannerId] ?? []).length} |`);
		}
		lines.push(``);
		return lines.join("\n");
	}

	for (const scannerId of result.scannersRun) {
		const issues = grouped[scannerId] ?? [];
		lines.push(`## ${SCANNER_LABELS[scannerId]} (${issues.length})`);
		lines.push(``);

		if (issues.length === 0) {
			lines.push(`No issues found.`);
			lines.push(``);
			continue;
		}

		for (const issue of issues) {
			lines.push(`### ${escapeMd(issue.title)}`);
			lines.push(``);
			lines.push(`- **Severity:** ${issue.severity}`);
			lines.push(`- **Classification:** ${issue.classification}`);
			lines.push(`- **Why:** ${escapeMd(issue.explanation.why)}`);
			if (issue.explanation.caveat) {
				lines.push(`- **Caveat:** ${escapeMd(issue.explanation.caveat)}`);
			}
			lines.push(`- **Next step:** ${escapeMd(issue.explanation.nextStep)}`);
			const location = issue.primaryPath ?? issue.relatedPaths[0];
			if (location) lines.push(`- **Location:** \`${escapeInlineCode(location)}\``);
			lines.push(`- **Message:** ${escapeMd(issue.message)}`);
			for (const detail of getMarkdownDetails(issue)) {
				if ("value" in detail) {
					lines.push(`- **${detail.label}:** ${detail.value}`);
				} else {
					lines.push(`- **${detail.label}:**`);
					for (const item of detail.items) {
						lines.push(`  - ${item}`);
					}
				}
			}
			lines.push(``);
		}
	}

	return lines.join("\n");
}

type MarkdownDetail =
	| { label: string; value: string }
	| { label: string; items: string[] };

function getMarkdownDetails(issue: Issue): MarkdownDetail[] {
	const details: MarkdownDetail[] = [];
	const target = getIssueTarget(issue);
	if (target) details.push({ label: getTargetLabel(issue), value: formatCode(target) });

	if (issue.scannerId === "external-links") {
		const status = getNumber(issue.evidence.status);
		const timeoutMs = getNumber(issue.evidence.timeoutMs);
		const error = issue.evidence.error;
		if (status !== null) details.push({ label: "Status", value: String(status) });
		if (timeoutMs !== null) details.push({ label: "Timeout", value: `${timeoutMs}ms` });
		if (typeof error === "string") details.push({ label: "Error", value: escapeMd(error) });
	}

	if (issue.scannerId === "broken-links") {
		const link = issue.evidence.link;
		if (typeof link === "string") details.push({ label: "Link text", value: formatCode(link) });
	}

	if (issue.scannerId === "duplicate-files") {
		const count = getNumber(issue.evidence.count);
		if (count !== null) details.push({ label: "Count", value: String(count) });
		const size = getNumber(issue.evidence.size);
		if (size !== null) details.push({ label: "Size", value: formatSize(size) });
		const paths = getEvidencePaths(issue);
		if (paths.length > 0) {
			details.push({
				label: "Files",
				items: paths.map((path) => formatCode(path)),
			});
		}
	}

	if (issue.scannerId === "frontmatter-types") {
		const property = issue.evidence.property;
		const types = issue.evidence.types;
		const fileCount = getNumber(issue.evidence.fileCount);
		if (typeof property === "string") details.push({ label: "Property", value: formatCode(property) });
		if (typeof types === "string") details.push({ label: "Types", value: escapeMd(types) });
		if (fileCount !== null) details.push({ label: "Files", value: String(fileCount) });
		if (issue.relatedPaths.length > 0) {
			details.push({
				label: "Samples",
				items: issue.relatedPaths.map((path) => formatCode(path)),
			});
		}
	}

	if (issue.scannerId === "tag-usage") {
		const tag = issue.evidence.tag;
		const count = getNumber(issue.evidence.count);
		const threshold = getNumber(issue.evidence.threshold);
		if (typeof tag === "string") details.push({ label: "Tag", value: formatTag(tag) });
		if (count !== null) details.push({ label: "Count", value: String(count) });
		if (threshold !== null) details.push({ label: "Threshold", value: String(threshold) });
		const paths = [issue.primaryPath, ...issue.relatedPaths].filter((path): path is string => Boolean(path));
		if (paths.length > 0) {
			details.push({
				label: "Files",
				items: paths.map((path) => formatCode(path)),
			});
		}
	}

	if (issue.scannerId === "large-files") {
		const size = getNumber(issue.evidence.size);
		const threshold = getNumber(issue.evidence.threshold);
		const type = issue.evidence.type;
		if (size !== null) details.push({ label: "Size", value: formatSize(size) });
		if (threshold !== null) details.push({ label: "Threshold", value: formatSize(threshold) });
		if (typeof type === "string") details.push({ label: "Type", value: escapeMd(type) });
	}

	if (issue.scannerId === "orphan-attachments") {
		const lastModified = getNumber(issue.evidence.lastModified);
		if (lastModified !== null) {
			details.push({ label: "Modified", value: new Date(lastModified).toLocaleString() });
		}
	}

	if (issue.scannerId === "empty-notes") {
		const size = getNumber(issue.evidence.size);
		if (size !== null) details.push({ label: "Size", value: formatSize(size) });
	}

	return details;
}

function getIssueTarget(issue: Issue): string | null {
	const url = issue.evidence.url;
	if (typeof url === "string") return url;
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

function formatTag(tag: string): string {
	return tag.startsWith("#") ? tag : `#${tag}`;
}

function formatCode(text: string): string {
	return `\`${escapeInlineCode(text)}\``;
}

function groupByScanner(issues: Issue[]): Record<string, Issue[]> {
	const groups: Record<string, Issue[]> = {};
	for (const issue of issues) {
		if (!groups[issue.scannerId]) groups[issue.scannerId] = [];
		groups[issue.scannerId].push(issue);
	}
	return groups;
}

function escapeMd(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeInlineCode(text: string): string {
	return text.replace(/`/g, "\\`");
}
