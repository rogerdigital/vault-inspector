import type { ScanResult } from "../scanner/Issue";
import type {
	ComparisonUnavailableReason,
	CurrentFindingStatus,
	LifecycleComparison,
} from "../scanner/result-diff";
import { countNewConfirmedFindings } from "./report-model";
import { formatDuration } from "../utils/format";

export type SummaryOptions = {
	comparison: LifecycleComparison;
	onReviewNewFindings?: () => void;
};

export function renderSummary(container: HTMLElement, result: ScanResult, options: SummaryOptions) {
	const duration = formatDuration(result.finishedAt - result.startedAt);

	const summary = container.createDiv({ cls: "vi-summary" });
	summary.createEl("h2", { text: "Scan results" });

	renderChanges(summary, result, options);

	const meta = summary.createDiv({ cls: "vi-meta" });
	meta.createSpan({ text: `${result.filesScanned} files scanned` });
	meta.createSpan({ text: duration });
	meta.createSpan({ text: `${result.scannersRun.length} scanners` });
	meta.createSpan({ text: `Ignored ${result.ignoredIssues.length}` });
}

function renderChanges(
	summary: HTMLElement,
	result: ScanResult,
	options: SummaryOptions,
): void {
	const comparison = options.comparison;
	const changes = summary.createDiv({ cls: "vi-changes" });

	if (!comparison.available) {
		renderUnavailableSummary(changes, result, comparison);
		return;
	}

	const newConfirmed = countNewConfirmedFindings(result.issues, comparison.statuses);
	const newCount = newConfirmed.errors + newConfirmed.warnings;
	const persistingCount = countStatus(result, comparison, "persisting");
	const resolvedCount = comparison.resolvedIssues.filter((issue) => !issue.ignored).length;

	const headline = changes.createDiv({ cls: "vi-changes-headline" });
	headline.createSpan({
		cls: "vi-changes-primary",
		text: countPhrase(newCount, "new finding"),
	});
	headline.createSpan({
		cls: "vi-changes-resolved",
		text: `${resolvedCount} resolved`,
	});

	const onReviewNewFindings = options.onReviewNewFindings;
	if (newCount > 0 && onReviewNewFindings) {
		const review = changes.createEl("button", {
			cls: "vi-review-new-btn mod-cta",
			text: "Review new findings",
			attr: { type: "button" },
		});
		review.addEventListener("click", onReviewNewFindings);
	}

	changes.createDiv({
		cls: "vi-changes-secondary",
		text: `${result.issues.length} active · ${persistingCount} previously found · compared with ${formatScanTime(comparison.previousScanAt!)}`,
	});
}

function renderUnavailableSummary(
	changes: HTMLElement,
	result: ScanResult,
	comparison: LifecycleComparison,
): void {
	const reason = comparison.reason ?? "first-scan";
	const headline = changes.createDiv({ cls: "vi-changes-headline" });

	if (reason === "first-scan") {
		headline.createSpan({ cls: "vi-changes-primary", text: "Scan complete" });
		changes.createDiv({
			cls: "vi-changes-secondary",
			text: `${countPhrase(result.issues.length, "active finding")} · Future scans will highlight what changed.`,
		});
		return;
	}

	headline.createSpan({ cls: "vi-changes-primary", text: "Comparison restarted" });
	changes.createDiv({
		cls: "vi-comparison-note",
		text: restartedMessage(reason, comparison.previousScanAt),
	});
}

function countStatus(
	result: ScanResult,
	comparison: LifecycleComparison,
	status: CurrentFindingStatus,
): number {
	return result.issues.filter(
		(issue) => comparison.statuses.get(issue.fingerprint) === status,
	).length;
}

function countPhrase(count: number, noun: string): string {
	return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function restartedMessage(
	reason: Exclude<ComparisonUnavailableReason, "first-scan">,
	previousScanAt?: number,
): string {
	const base = reason === "settings-changed"
		? "Scan settings changed; this scan is the new baseline."
		: "Scanner behavior changed; this scan is the new baseline.";
	if (previousScanAt === undefined) return base;
	return `${base} (previous successful scan: ${formatScanTime(previousScanAt)})`;
}

function formatScanTime(ms: number): string {
	return new Date(ms).toLocaleString();
}
