import {
	SCANNER_IDS,
	type FindingClassification,
	type ScanResult,
	type ScannerId,
} from "../scanner/Issue";
import type { LifecycleComparison } from "../scanner/result-diff";
import { COMPARISON_VERSION } from "./scan-snapshot";

export const HISTORY_SCHEMA_VERSION = 1;
/** Newest-first bound enforced at append AND load: at most 20 entries survive. */
export const MAX_HISTORY_ENTRIES = 20;

export type ScanTrigger = "manual" | "automatic";

export type ScanHistoryTotals = {
	active: number;
	ignored: number;
	newIssues: number;
	persistingIssues: number;
	resolvedIssues: number;
};

export type ScanHistoryEntry = {
	schemaVersion: 1;
	createdAt: number;
	toolVersion: string;
	scanProfile: string;
	comparisonVersion: number;
	trigger: ScanTrigger;
	filesScanned: number;
	scannersRun: ScannerId[];
	totals: ScanHistoryTotals;
	severityCounts: { error: number; warning: number; info: number };
	classificationCounts: { confirmed: number; candidate: number; unverified: number };
};

export type ScanHistoryEntryInput = {
	result: ScanResult;
	comparison: LifecycleComparison;
	scanProfile: string;
	toolVersion: string;
	trigger: ScanTrigger;
	createdAt?: number;
};

export function createScanHistoryEntry(input: ScanHistoryEntryInput): ScanHistoryEntry {
	const { result, comparison } = input;
	return {
		schemaVersion: HISTORY_SCHEMA_VERSION,
		createdAt: input.createdAt ?? Date.now(),
		toolVersion: input.toolVersion,
		scanProfile: input.scanProfile,
		comparisonVersion: COMPARISON_VERSION,
		trigger: input.trigger,
		filesScanned: result.filesScanned,
		scannersRun: [...result.scannersRun],
		totals: {
			active: result.issues.length,
			ignored: result.ignoredIssues.length,
			newIssues: countStatus(comparison, "new"),
			persistingIssues: countStatus(comparison, "persisting"),
			resolvedIssues: comparison.available ? comparison.resolvedIssues.length : 0,
		},
		severityCounts: countSeverities(result.issues),
		classificationCounts: countClassifications(result.issues),
	};
}

export function appendScanHistoryEntry(
	history: ScanHistoryEntry[],
	entry: ScanHistoryEntry,
): ScanHistoryEntry[] {
	return [entry, ...history].slice(0, MAX_HISTORY_ENTRIES);
}

export function isScanHistoryEntry(value: unknown): value is ScanHistoryEntry {
	if (!isPlainRecord(value)) return false;
	if (
		!hasOnlyKeys(value, [
			"schemaVersion",
			"createdAt",
			"toolVersion",
			"scanProfile",
			"comparisonVersion",
			"trigger",
			"filesScanned",
			"scannersRun",
			"totals",
			"severityCounts",
			"classificationCounts",
		])
	) {
		return false;
	}
	if (value.schemaVersion !== HISTORY_SCHEMA_VERSION) return false;
	if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return false;
	if (typeof value.toolVersion !== "string") return false;
	if (typeof value.scanProfile !== "string") return false;
	if (
		typeof value.comparisonVersion !== "number"
		|| !Number.isSafeInteger(value.comparisonVersion)
		|| value.comparisonVersion <= 0
	) {
		return false;
	}
	if (!isOneOf(value.trigger, ["manual", "automatic"])) return false;
	if (!isCount(value.filesScanned)) return false;
	if (!Array.isArray(value.scannersRun) || value.scannersRun.length === 0) return false;
	const seen = new Set<string>();
	for (const scannerId of value.scannersRun) {
		if (typeof scannerId !== "string") return false;
		if (!SCANNER_IDS.includes(scannerId as ScannerId)) return false;
		if (seen.has(scannerId)) return false;
		seen.add(scannerId);
	}
	if (
		!isCountRecord(value.totals, [
			"active",
			"ignored",
			"newIssues",
			"persistingIssues",
			"resolvedIssues",
		])
	) {
		return false;
	}
	if (!isCountRecord(value.severityCounts, ["error", "warning", "info"])) return false;
	if (
		!isCountRecord(value.classificationCounts, ["confirmed", "candidate", "unverified"])
	) {
		return false;
	}
	return true;
}

export function parseScanHistory(value: unknown): ScanHistoryEntry[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter(isScanHistoryEntry)
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, MAX_HISTORY_ENTRIES);
}

function countStatus(
	comparison: LifecycleComparison,
	status: "new" | "persisting",
): number {
	if (!comparison.available) return 0;
	let total = 0;
	for (const value of comparison.statuses.values()) {
		if (value === status) total += 1;
	}
	return total;
}

function countSeverities(issues: ScanResult["issues"]): ScanHistoryEntry["severityCounts"] {
	const counts: { error: number; warning: number; info: number } = {
		error: 0,
		warning: 0,
		info: 0,
	};
	for (const issue of issues) counts[issue.severity] += 1;
	return counts;
}

function countClassifications(
	issues: ScanResult["issues"],
): ScanHistoryEntry["classificationCounts"] {
	const counts: Record<FindingClassification, number> = {
		confirmed: 0,
		candidate: 0,
		unverified: 0,
	};
	for (const issue of issues) counts[issue.classification] += 1;
	return counts;
}

function isCount(value: unknown): boolean {
	return (
		typeof value === "number"
		&& Number.isSafeInteger(value)
		&& value >= 0
	);
}

function isCountRecord(value: unknown, keys: readonly string[]): boolean {
	if (!isPlainRecord(value)) return false;
	if (!hasOnlyKeys(value, keys)) return false;
	return keys.every((key) => isCount(value[key]));
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
