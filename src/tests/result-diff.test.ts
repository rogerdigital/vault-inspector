import { describe, expect, it } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import { compareScanResult } from "../scanner/result-diff";
import {
	COMPARISON_VERSION,
	createScanSnapshot,
	isScanSnapshot,
	type ScanSnapshot,
	type SnapshotIssue,
} from "../snapshot/scan-snapshot";

function makeIssue(fingerprint: string): Issue {
	return {
		scannerId: "empty-notes",
		severity: "warning",
		classification: "confirmed",
		title: "Empty note",
		message: `Empty note ${fingerprint}`,
		primaryPath: `${fingerprint}.md`,
		relatedPaths: [],
		evidence: { words: 0 },
		explanation: {
			why: "The note has no meaningful content.",
			nextStep: "Add content or remove the note.",
		},
		fingerprint,
	};
}

function makeResult(issues: Issue[], ignoredIssues: Issue[] = []): ScanResult {
	return {
		startedAt: 1,
		finishedAt: 2,
		issues,
		ignoredIssues,
		filesScanned: issues.length + ignoredIssues.length,
		scannersRun: ["empty-notes"],
	};
}

function makeSnapshot(issues: Issue[], ignoredIssues: Issue[] = [], profile = "profile") {
	return createScanSnapshot(makeResult(issues, ignoredIssues), profile, "0.5.0", 1);
}

describe("compareScanResult", () => {
	it("reports the first scan without lifecycle claims", () => {
		const result = compareScanResult(makeResult([makeIssue("current")]), null, "profile");

		expect(result).toEqual({
			available: false,
			reason: "first-scan",
			statuses: new Map(),
			resolvedIssues: [],
		});
	});

	it("rejects changed comparison semantics before checking settings", () => {
		const snapshot = {
			...makeSnapshot([makeIssue("previous")], [], "old-profile"),
			comparisonVersion: 3,
		} as unknown as ScanSnapshot;

		expect(isScanSnapshot(snapshot)).toBe(true);
		expect(compareScanResult(makeResult([]), snapshot, "new-profile")).toEqual({
			available: false,
			reason: "semantics-changed",
			statuses: new Map(),
			resolvedIssues: [],
		});
	});

	it("rejects changed detection settings", () => {
		const snapshot = makeSnapshot([makeIssue("previous")], [], "old-profile");

		expect(compareScanResult(makeResult([]), snapshot, "new-profile")).toEqual({
			available: false,
			reason: "settings-changed",
			statuses: new Map(),
			resolvedIssues: [],
		});
	});

	it("classifies active and ignored findings and resolves missing findings", () => {
		const previous = makeSnapshot(
			[makeIssue("active-persisting"), makeIssue("active-resolved")],
			[makeIssue("ignored-persisting"), makeIssue("ignored-resolved")],
		);
		const current = makeResult(
			[makeIssue("active-persisting"), makeIssue("active-new")],
			[makeIssue("ignored-persisting"), makeIssue("ignored-new")],
		);

		const result = compareScanResult(current, previous, "profile");

		expect(result.available).toBe(true);
		expect(result.reason).toBeUndefined();
		expect(Array.from(result.statuses)).toEqual([
			["active-persisting", "persisting"],
			["active-new", "new"],
			["ignored-persisting", "persisting"],
			["ignored-new", "new"],
		]);
		expect(result.resolvedIssues.map((issue) => [issue.fingerprint, issue.ignored])).toEqual([
			["active-resolved", false],
			["ignored-resolved", true],
		]);
	});

	it("does not resolve a previously active finding that is now ignored", () => {
		const previous = makeSnapshot([makeIssue("same")]);
		const current = makeResult([], [makeIssue("same")]);

		const result = compareScanResult(current, previous, "profile");

		expect(result.statuses.get("same")).toBe("persisting");
		expect(result.resolvedIssues).toEqual([]);
	});

	it("preserves deterministic current and previous snapshot order without mutation", () => {
		const previous = makeSnapshot([
			makeIssue("resolved-second"),
			makeIssue("persisting"),
			makeIssue("resolved-third"),
		]);
		const current = makeResult([makeIssue("new-second"), makeIssue("persisting")]);
		const previousBefore = structuredClone(previous);
		const currentBefore = structuredClone(current);

		const result = compareScanResult(current, previous, "profile");

		expect(Array.from(result.statuses.keys())).toEqual(["new-second", "persisting"]);
		expect(result.resolvedIssues.map((issue) => issue.fingerprint)).toEqual([
			"resolved-second",
			"resolved-third",
		]);
		expect(previous).toEqual(previousBefore);
		expect(current).toEqual(currentBefore);
	});

	it("handles 10,000 current and previous fingerprints", () => {
		const previousIssues: SnapshotIssue[] = Array.from({ length: 10_000 }, (_, index) => ({
			...makeIssue(`previous-${index}`),
			ignored: index % 2 === 1,
		}));
		const snapshot: ScanSnapshot = {
			schemaVersion: 1,
			comparisonVersion: COMPARISON_VERSION,
			toolVersion: "0.5.0",
			createdAt: 1,
			scanProfile: "profile",
			issues: previousIssues,
		};
		const current = makeResult([
			...Array.from({ length: 5_000 }, (_, index) => makeIssue(`previous-${index}`)),
			...Array.from({ length: 5_000 }, (_, index) => makeIssue(`new-${index}`)),
		]);

		const result = compareScanResult(current, snapshot, "profile");

		expect(result.statuses.size).toBe(10_000);
		expect(result.resolvedIssues).toHaveLength(5_000);
	});
});
