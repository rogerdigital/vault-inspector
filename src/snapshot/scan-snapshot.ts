import {
	SCANNER_IDS,
	type FindingClassification,
	type FindingExplanation,
	type Issue,
	type IssueSeverity,
	type ScannerId,
	type ScanResult,
} from "../scanner/Issue";

export const SNAPSHOT_SCHEMA_VERSION = 1;
/**
 * 2 — external-link outcomes are classified per status (404/410 dead-link
 * candidates, 401/403 access-restricted, 429 rate-limited, 5xx server
 * error). Fingerprints for the reclassified findings changed identity, so
 * pre-2 snapshots cannot be compared without false resolved/new claims.
 */
export const COMPARISON_VERSION = 2;

export type SnapshotIssue = {
	fingerprint: string;
	scannerId: ScannerId;
	severity: IssueSeverity;
	classification: FindingClassification;
	title: string;
	message: string;
	primaryPath?: string;
	relatedPaths: string[];
	evidence: Record<string, string | number | boolean>;
	explanation: FindingExplanation;
	ignored: boolean;
};

export type ScanSnapshot = {
	schemaVersion: 1;
	comparisonVersion: number;
	toolVersion: string;
	createdAt: number;
	scanProfile: string;
	issues: SnapshotIssue[];
};

export function createScanSnapshot(
	result: ScanResult,
	scanProfile: string,
	toolVersion: string,
	createdAt = Date.now(),
): ScanSnapshot {
	return {
		schemaVersion: SNAPSHOT_SCHEMA_VERSION,
		comparisonVersion: COMPARISON_VERSION,
		toolVersion,
		createdAt,
		scanProfile,
		issues: [
			...result.issues.map((issue) => toSnapshotIssue(issue, false)),
			...result.ignoredIssues.map((issue) => toSnapshotIssue(issue, true)),
		],
	};
}

export function isScanSnapshot(value: unknown): value is ScanSnapshot {
	if (!isPlainRecord(value)) return false;
	if (
		!hasOnlyKeys(value, [
			"schemaVersion",
			"comparisonVersion",
			"toolVersion",
			"createdAt",
			"scanProfile",
			"issues",
		])
	) {
		return false;
	}
	if (value.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return false;
	if (
		typeof value.comparisonVersion !== "number" ||
		!Number.isSafeInteger(value.comparisonVersion) ||
		value.comparisonVersion <= 0
	) {
		return false;
	}
	if (typeof value.toolVersion !== "string") return false;
	if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return false;
	if (typeof value.scanProfile !== "string") return false;
	if (!Array.isArray(value.issues)) return false;

	const fingerprints = new Set<string>();
	for (const issue of value.issues) {
		if (!isSnapshotIssue(issue)) return false;
		if (fingerprints.has(issue.fingerprint)) return false;
		fingerprints.add(issue.fingerprint);
	}

	return true;
}

function toSnapshotIssue(issue: Issue, ignored: boolean): SnapshotIssue {
	return {
		fingerprint: issue.fingerprint,
		scannerId: issue.scannerId,
		severity: issue.severity,
		classification: issue.classification,
		title: issue.title,
		message: issue.message,
		...(issue.primaryPath === undefined ? {} : { primaryPath: issue.primaryPath }),
		relatedPaths: [...issue.relatedPaths],
		evidence: { ...issue.evidence },
		explanation: { ...issue.explanation },
		ignored,
	};
}

function isSnapshotIssue(value: unknown): value is SnapshotIssue {
	if (!isPlainRecord(value)) return false;
	if (
		!hasOnlyKeys(value, [
			"fingerprint",
			"scannerId",
			"severity",
			"classification",
			"title",
			"message",
			"primaryPath",
			"relatedPaths",
			"evidence",
			"explanation",
			"ignored",
		])
	) {
		return false;
	}
	if (typeof value.fingerprint !== "string" || value.fingerprint.trim() === "") {
		return false;
	}
	if (!SCANNER_IDS.includes(value.scannerId as ScannerId)) return false;
	if (!isOneOf(value.severity, ["info", "warning", "error"])) return false;
	if (!isOneOf(value.classification, ["confirmed", "candidate", "unverified"])) {
		return false;
	}
	if (typeof value.title !== "string" || typeof value.message !== "string") return false;
	if (value.primaryPath !== undefined && typeof value.primaryPath !== "string") return false;
	if (!Array.isArray(value.relatedPaths)) return false;
	if (!value.relatedPaths.every((path) => typeof path === "string")) return false;
	if (!isScalarRecord(value.evidence)) return false;
	if (!isFindingExplanation(value.explanation)) return false;
	return typeof value.ignored === "boolean";
}

function isFindingExplanation(value: unknown): value is FindingExplanation {
	if (!isPlainRecord(value)) return false;
	if (!hasOnlyKeys(value, ["why", "caveat", "nextStep"])) return false;
	if (typeof value.why !== "string" || typeof value.nextStep !== "string") return false;
	return value.caveat === undefined || typeof value.caveat === "string";
}

function isScalarRecord(
	value: unknown,
): value is Record<string, string | number | boolean> {
	if (!isPlainRecord(value)) return false;
	return Reflect.ownKeys(value).every((key) => {
		if (typeof key !== "string") return false;
		const item = value[key];
		return (
			typeof item === "string" ||
			typeof item === "boolean" ||
			(typeof item === "number" && Number.isFinite(item))
		);
	});
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const prototype = Object.getPrototypeOf(value) as unknown;
	return prototype === Object.prototype || prototype === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	return Reflect.ownKeys(value).every(
		(key) => typeof key === "string" && allowed.includes(key),
	);
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === "string" && allowed.includes(value as T);
}
