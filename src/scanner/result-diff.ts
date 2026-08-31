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
	if (snapshot.comparisonVersion !== COMPARISON_VERSION) {
		return { ...unavailable("semantics-changed"), previousScanAt: snapshot.createdAt };
	}
	if (snapshot.scanProfile !== currentProfile) {
		return { ...unavailable("settings-changed"), previousScanAt: snapshot.createdAt };
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
