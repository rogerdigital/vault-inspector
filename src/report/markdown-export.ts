import type { ScanResult, Issue } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";

export function generateMarkdownReport(result: ScanResult): string {
	const lines: string[] = [];
	const now = new Date();

	lines.push(`# Vault Inspector Report`);
	lines.push(``);
	lines.push(`- **Date:** ${now.toLocaleString()}`);
	lines.push(`- **Files scanned:** ${result.filesScanned}`);
	lines.push(`- **Duration:** ${((result.finishedAt - result.startedAt) / 1000).toFixed(1)}s`);
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

	for (const scannerId of result.scannersRun) {
		const issues = grouped[scannerId] ?? [];
		lines.push(`## ${SCANNER_LABELS[scannerId]} (${issues.length})`);
		lines.push(``);

		if (issues.length === 0) {
			lines.push(`No issues found.`);
			lines.push(``);
			continue;
		}

		lines.push(`| Severity | Title | File | Message |`);
		lines.push(`|---|---|---|---|`);

		for (const issue of issues) {
			const title = escapeMd(issue.title);
			const path = issue.primaryPath ? escapeMd(issue.primaryPath) : "-";
			const message = escapeMd(issue.message);
			lines.push(`| ${issue.severity} | ${title} | \`${path}\` | ${message} |`);
		}
		lines.push(``);
	}

	return lines.join("\n");
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
