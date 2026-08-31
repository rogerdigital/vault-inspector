import type { ScanResult } from "./Issue";
import {
	COMPARISON_VERSION,
	type ScanSnapshot,
	type SnapshotIssue,
} from "../snapshot/scan-snapshot";

export type CurrentFindingStatus = "new" | "persisting";

export type ComparisonUnavailableReason =
	| "first-scan"
	| "settings-changed"
	| "semantics-changed";

/**
 * Shared compatibility gate for baseline comparisons. Order matters and
 * mirrors compareScanResult: a comparison-version (semantics) mismatch is
 * reported before a scan-profile (settings) mismatch, because fingerprint
 * identity itself cannot be trusted across semantics changes.
 */
export type BaselineMismatchReason = "settings-changed" | "semantics-changed";

export function resolveBaselineCompatibility(
	baselineComparisonVersion: number,
	baselineScanProfile: string,
	currentProfile: string,
): BaselineMismatchReason | null {
	if (baselineComparisonVersion !== COMPARISON_VERSION) return "semantics-changed";
	if (baselineScanProfile !== currentProfile) return "settings-changed";
	return null;
}

export type LifecycleComparison = {
	available: boolean;
	reason?: ComparisonUnavailableReason;
	/** When the baseline snapshot was captured; absent when there is no snapshot. */
	previousScanAt?: number;
	statuses: Map<string, CurrentFindingStatus>;
	resolvedIssues: SnapshotIssue[];
};

export function compareScanResult(
	current: ScanResult,
	snapshot: ScanSnapshot | null,
	currentProfile: string,
): LifecycleComparison {
	if (snapshot === null) return unavailable("first-scan");
	const mismatch = resolveBaselineCompatibility(
		snapshot.comparisonVersion,
		snapshot.scanProfile,
		currentProfile,
	);
	if (mismatch) {
		return { ...unavailable(mismatch), previousScanAt: snapshot.createdAt };
	}

	const previousByFingerprint = new Map(
		snapshot.issues.map((issue) => [issue.fingerprint, issue] as const),
	);
	const statuses = new Map<string, CurrentFindingStatus>();
	const currentFingerprints = new Set<string>();

	for (const issue of current.issues) {
		currentFingerprints.add(issue.fingerprint);
		statuses.set(
			issue.fingerprint,
			previousByFingerprint.has(issue.fingerprint) ? "persisting" : "new",
		);
	}
	for (const issue of current.ignoredIssues) {
		currentFingerprints.add(issue.fingerprint);
		statuses.set(
			issue.fingerprint,
			previousByFingerprint.has(issue.fingerprint) ? "persisting" : "new",
		);
	}

	const resolvedIssues = snapshot.issues.filter(
		(issue) => !currentFingerprints.has(issue.fingerprint),
	);

	return {
		available: true,
		previousScanAt: snapshot.createdAt,
		statuses,
		resolvedIssues,
	};
}

function unavailable(reason: ComparisonUnavailableReason): LifecycleComparison {
	return {
		available: false,
		reason,
		statuses: new Map(),
		resolvedIssues: [],
	};
}
