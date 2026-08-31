import { describe, expect, it } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import type { LifecycleComparison } from "../scanner/result-diff";
import { createScanSnapshot } from "../snapshot/scan-snapshot";
import {
	appendScanHistoryEntry,
	createScanHistoryEntry,
	HISTORY_SCHEMA_VERSION,
	isScanHistoryEntry,
	MAX_HISTORY_ENTRIES,
	parseScanHistory,
	type ScanHistoryEntry,
} from "../snapshot/scan-history";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		scannerId: "broken-links",
		severity: "error",
		classification: "confirmed",
		title: "Broken link",
		message: "Missing target",
		primaryPath: "notes/source.md",
		relatedPaths: ["notes/missing.md"],
		evidence: { linkText: "missing" },
		explanation: {
			why: "The target does not exist.",
			nextStep: "Create the target or update the link.",
		},
		fingerprint: "broken-link-1",
		...overrides,
	};
}

function makeResult(issues: Issue[], ignoredIssues: Issue[] = []): ScanResult {
	return {
		startedAt: 10,
		finishedAt: 20,
		issues,
		ignoredIssues,
		filesScanned: 3,
		scannersRun: ["broken-links", "empty-notes"],
	};
}

function makeComparison(available: boolean): LifecycleComparison {
	if (!available) {
		return {
			available: false,
			reason: "first-scan",
			statuses: new Map(),
			resolvedIssues: [],
		};
	}
	const previous = createScanSnapshot(
		makeResult([
			makeIssue({ fingerprint: "persisting" }),
			makeIssue({
				fingerprint: "resolved",
				severity: "info",
				classification: "candidate",
			}),
		]),
		"profile-1",
		"0.5.0",
		100,
	);
	return {
		available: true,
		statuses: new Map([
			["new", "new"],
			["persisting", "persisting"],
			["ignored-new", "new"],
		]),
		resolvedIssues: previous.issues.filter(
			(issue) => issue.fingerprint === "resolved",
		),
	};
}

function entryForHistoryTest(createdAt: number): ScanHistoryEntry {
	return createScanHistoryEntry({
		result: makeResult([makeIssue()]),
		comparison: makeComparison(false),
		scanProfile: "profile-1",
		toolVersion: "0.7.0",
		trigger: "manual",
		createdAt,
	});
}

describe("createScanHistoryEntry", () => {
	it("records the roadmap fields from a result and an available comparison", () => {
		const current = makeResult(
			[
				makeIssue({ fingerprint: "new", severity: "warning", classification: "candidate" }),
				makeIssue({ fingerprint: "persisting" }),
			],
			[makeIssue({
				fingerprint: "ignored-new",
				severity: "info",
				classification: "unverified",
			})],
		);

		const entry = createScanHistoryEntry({
			result: current,
			comparison: makeComparison(true),
			scanProfile: "profile-abc",
			toolVersion: "0.7.0",
			trigger: "manual",
			createdAt: 1_725_000_000_000,
		});

		expect(entry).toEqual({
			schemaVersion: HISTORY_SCHEMA_VERSION,
			createdAt: 1_725_000_000_000,
			toolVersion: "0.7.0",
			scanProfile: "profile-abc",
			comparisonVersion: 2,
			trigger: "manual",
			filesScanned: 3,
			scannersRun: ["broken-links", "empty-notes"],
			totals: {
				active: 2,
				ignored: 1,
				newIssues: 2,
				persistingIssues: 1,
				resolvedIssues: 1,
			},
			severityCounts: { error: 1, warning: 1, info: 0 },
			classificationCounts: { confirmed: 1, candidate: 1, unverified: 0 },
		});
	});

	it("records zero lifecycle totals when comparison is unavailable", () => {
		const entry = createScanHistoryEntry({
			result: makeResult([makeIssue()]),
			comparison: makeComparison(false),
			scanProfile: "profile-1",
			toolVersion: "0.7.0",
			trigger: "manual",
			createdAt: 1,
		});

		expect(entry.totals).toEqual({
			active: 1,
			ignored: 0,
			newIssues: 0,
			persistingIssues: 0,
			resolvedIssues: 0,
		});
	});

	it("clones the scanners-run list from the result", () => {
		const result = makeResult([makeIssue()]);
		const entry = createScanHistoryEntry({
			result,
			comparison: makeComparison(false),
			scanProfile: "profile-1",
			toolVersion: "0.7.0",
			trigger: "manual",
			createdAt: 1,
		});

		result.scannersRun.push("large-files");

		expect(entry.scannersRun).toEqual(["broken-links", "empty-notes"]);
	});
});

describe("appendScanHistoryEntry", () => {
	it("prepends newest-first and drops the oldest beyond twenty entries", () => {
		let history: ScanHistoryEntry[] = [];
		for (let index = 0; index < MAX_HISTORY_ENTRIES + 1; index++) {
			history = appendScanHistoryEntry(history, entryForHistoryTest(index));
		}

		expect(history).toHaveLength(MAX_HISTORY_ENTRIES);
		expect(history[0].createdAt).toBe(MAX_HISTORY_ENTRIES);
		expect(history[MAX_HISTORY_ENTRIES - 1].createdAt).toBe(1);
	});
});

describe("isScanHistoryEntry", () => {
	it("accepts a created entry", () => {
		expect(isScanHistoryEntry(entryForHistoryTest(1))).toBe(true);
	});

	it("accepts a structurally valid entry from another comparison version", () => {
		const entry = { ...entryForHistoryTest(1), comparisonVersion: 99 };
		expect(isScanHistoryEntry(entry)).toBe(true);
	});

	it.each([
		["wrong schema version", (value: Record<string, unknown>) => { value.schemaVersion = 2; }],
		["non-finite created time", (value: Record<string, unknown>) => { value.createdAt = Number.NaN; }],
		["non-string tool version", (value: Record<string, unknown>) => { value.toolVersion = 7; }],
		["non-string scan profile", (value: Record<string, unknown>) => { value.scanProfile = false; }],
		["zero comparison version", (value: Record<string, unknown>) => { value.comparisonVersion = 0; }],
		["fractional comparison version", (value: Record<string, unknown>) => { value.comparisonVersion = 1.5; }],
		["unknown trigger", (value: Record<string, unknown>) => { value.trigger = "scheduled"; }],
		["negative files scanned", (value: Record<string, unknown>) => { value.filesScanned = -1; }],
		["fractional files scanned", (value: Record<string, unknown>) => { value.filesScanned = 1.5; }],
		["empty scanners run", (value: Record<string, unknown>) => { value.scannersRun = []; }],
		["unknown scanner id", (value: Record<string, unknown>) => { value.scannersRun = ["mystery"]; }],
		["duplicate scanner ids", (value: Record<string, unknown>) => { value.scannersRun = ["broken-links", "broken-links"]; }],
		["negative total", (value: Record<string, unknown>) => { (value.totals as Record<string, unknown>).active = -2; }],
		["fractional total", (value: Record<string, unknown>) => { (value.totals as Record<string, unknown>).newIssues = 0.5; }],
		["missing total key", (value: Record<string, unknown>) => { delete (value.totals as Record<string, unknown>).resolvedIssues; }],
		["extra severity key", (value: Record<string, unknown>) => { (value.severityCounts as Record<string, unknown>).critical = 1; }],
		["missing classification key", (value: Record<string, unknown>) => { delete (value.classificationCounts as Record<string, unknown>).unverified; }],
		["unknown root field", (value: Record<string, unknown>) => { value.issues = []; }],
	] as const)("rejects %s", (_name, mutate) => {
		const candidate = entryForHistoryTest(1) as unknown as Record<string, unknown>;
		mutate(candidate);
		expect(isScanHistoryEntry(candidate)).toBe(false);
	});

	it("rejects a non-plain record", () => {
		const candidate = Object.assign(
			Object.create({ inherited: true }),
			entryForHistoryTest(1),
		);
		expect(isScanHistoryEntry(candidate)).toBe(false);
	});
});

describe("parseScanHistory", () => {
	it("returns an empty history for non-array values", () => {
		expect(parseScanHistory(undefined)).toEqual([]);
		expect(parseScanHistory("nope")).toEqual([]);
		expect(parseScanHistory({})).toEqual([]);
	});

	it("discards invalid entries individually and keeps valid ones", () => {
		const newest = entryForHistoryTest(3);
		const oldest = entryForHistoryTest(1);

		expect(parseScanHistory([
			newest,
			{ schemaVersion: 1 },
			null,
			oldest,
		])).toEqual([newest, oldest]);
	});

	it("keeps only the newest twenty valid entries after discarding invalid ones", () => {
		const entries = Array.from({ length: MAX_HISTORY_ENTRIES + 2 }, (_, index) =>
			entryForHistoryTest(index));
		const corrupted = { ...entryForHistoryTest(999), trigger: "scheduled" };

		const parsed = parseScanHistory([
			...entries.slice(0, MAX_HISTORY_ENTRIES),
			corrupted,
			entries[MAX_HISTORY_ENTRIES],
			entries[MAX_HISTORY_ENTRIES + 1],
		]);

		expect(parsed).toHaveLength(MAX_HISTORY_ENTRIES);
		expect(parsed[0].createdAt).toBe(MAX_HISTORY_ENTRIES + 1);
		expect(parsed[MAX_HISTORY_ENTRIES - 1].createdAt).toBe(2);
	});
});
