import { describe, expect, it } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import {
	COMPARISON_VERSION,
	SNAPSHOT_SCHEMA_VERSION,
	createScanSnapshot,
	isScanSnapshot,
} from "../snapshot/scan-snapshot";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		scannerId: "broken-links",
		severity: "error",
		classification: "confirmed",
		title: "Broken link",
		message: "Missing target",
		primaryPath: "notes/source.md",
		relatedPaths: ["notes/missing.md"],
		evidence: { linkText: "missing", count: 1, embedded: false },
		explanation: {
			why: "The target does not exist.",
			caveat: "The target may be created later.",
			nextStep: "Create the target or update the link.",
		},
		fingerprint: "broken-link-1",
		fixAction: {
			kind: "remove-link-text",
			label: "Remove link",
			description: "Replace the link with plain text",
			targetPaths: ["notes/source.md"],
			linkText: "missing",
		},
		...overrides,
	};
}

function makeResult(issues: Issue[], ignoredIssues: Issue[]): ScanResult {
	return {
		startedAt: 10,
		finishedAt: 20,
		issues,
		ignoredIssues,
		filesScanned: 3,
		scannersRun: ["broken-links"],
	};
}

describe("scan snapshots", () => {
	it("creates a versioned snapshot with active issues before ignored issues", () => {
		const active = makeIssue();
		const ignored = makeIssue({
			fingerprint: "ignored-1",
			scannerId: "empty-notes",
			severity: "warning",
			classification: "candidate",
		});

		const snapshot = createScanSnapshot(
			makeResult([active], [ignored]),
			"profile-abc",
			"0.5.0",
			1_725_000_000_000,
		);

		expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
		expect(COMPARISON_VERSION).toBe(2);
		expect(snapshot).toEqual({
			schemaVersion: 1,
			comparisonVersion: 2,
			toolVersion: "0.5.0",
			createdAt: 1_725_000_000_000,
			scanProfile: "profile-abc",
			issues: [
				{
					fingerprint: "broken-link-1",
					scannerId: "broken-links",
					severity: "error",
					classification: "confirmed",
					title: "Broken link",
					message: "Missing target",
					primaryPath: "notes/source.md",
					relatedPaths: ["notes/missing.md"],
					evidence: { linkText: "missing", count: 1, embedded: false },
					explanation: {
						why: "The target does not exist.",
						caveat: "The target may be created later.",
						nextStep: "Create the target or update the link.",
					},
					ignored: false,
				},
				{
					fingerprint: "ignored-1",
					scannerId: "empty-notes",
					severity: "warning",
					classification: "candidate",
					title: "Broken link",
					message: "Missing target",
					primaryPath: "notes/source.md",
					relatedPaths: ["notes/missing.md"],
					evidence: { linkText: "missing", count: 1, embedded: false },
					explanation: {
						why: "The target does not exist.",
						caveat: "The target may be created later.",
						nextStep: "Create the target or update the link.",
					},
					ignored: true,
				},
			],
		});
		expect(snapshot.issues[0]).not.toHaveProperty("fixAction");
	});

	it("clones mutable issue details", () => {
		const issue = makeIssue();
		const snapshot = createScanSnapshot(makeResult([issue], []), "profile", "0.5.0", 1);

		issue.relatedPaths.push("later.md");
		issue.evidence.count = 99;
		issue.explanation.why = "Changed after the scan";
		issue.explanation.caveat = "Changed caveat";
		issue.explanation.nextStep = "Changed next step";

		expect(snapshot.issues[0].relatedPaths).toEqual(["notes/missing.md"]);
		expect(snapshot.issues[0].evidence).toEqual({
			linkText: "missing",
			count: 1,
			embedded: false,
		});
		expect(snapshot.issues[0].explanation).toEqual({
			why: "The target does not exist.",
			caveat: "The target may be created later.",
			nextStep: "Create the target or update the link.",
		});
	});

	it("accepts complete snapshots", () => {
		const snapshot = createScanSnapshot(
			makeResult([makeIssue()], []),
			"profile",
			"0.5.0",
			100,
		);

		expect(isScanSnapshot(snapshot)).toBe(true);
	});

	it("accepts a structurally valid snapshot from a different comparison version", () => {
		const snapshot = createScanSnapshot(
			makeResult([makeIssue()], []),
			"profile",
			"0.4.0",
			100,
		) as unknown as Record<string, unknown>;
		snapshot.comparisonVersion = COMPARISON_VERSION + 1;

		expect(isScanSnapshot(snapshot)).toBe(true);
	});

	it.each([0, -1, 1.5, Number.NaN, "1"])(
		"rejects invalid comparison version %s",
		(comparisonVersion) => {
			const snapshot = createScanSnapshot(
				makeResult([makeIssue()], []),
				"profile",
				"0.5.0",
				100,
			) as unknown as Record<string, unknown>;
			snapshot.comparisonVersion = comparisonVersion;

			expect(isScanSnapshot(snapshot)).toBe(false);
		},
	);

	it.each([
		["wrong schema version", (value: Record<string, unknown>) => { value.schemaVersion = 2; }],
		["non-finite created time", (value: Record<string, unknown>) => { value.createdAt = Number.NaN; }],
		["non-string tool version", (value: Record<string, unknown>) => { value.toolVersion = 5; }],
		["non-string scan profile", (value: Record<string, unknown>) => { value.scanProfile = false; }],
		["invalid scanner", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.scannerId = "unknown"; }],
		["invalid severity", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.severity = "critical"; }],
		["invalid classification", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.classification = "certain"; }],
		["non-string title", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.title = 1; }],
		["non-string message", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.message = null; }],
		["malformed explanation", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.explanation = { why: "why", nextStep: 3 }; }],
		["non-string explanation caveat", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.explanation = { why: "why", caveat: false, nextStep: "next" }; }],
		["non-string primary path", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.primaryPath = 7; }],
		["malformed related paths", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.relatedPaths = ["valid.md", 2]; }],
		["non-record evidence", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.evidence = []; }],
		["non-scalar evidence", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.evidence = { nested: { invalid: true } }; }],
		["non-finite numeric evidence", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.evidence = { size: Number.POSITIVE_INFINITY }; }],
		["non-string fingerprint", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.fingerprint = 42; }],
		["blank fingerprint", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.fingerprint = "  \t"; }],
		["non-boolean ignored flag", (_value: Record<string, unknown>, issue: Record<string, unknown>) => { issue.ignored = "false"; }],
		["malformed issue", (value: Record<string, unknown>) => { value.issues = [null]; }],
	] as const)("rejects %s", (_name, mutate) => {
		const valid = createScanSnapshot(
			makeResult([makeIssue()], []),
			"profile",
			"0.5.0",
			100,
		) as unknown as Record<string, unknown>;
		const candidate = structuredClone(valid);
		const issue = (candidate.issues as Array<Record<string, unknown>>)[0];

		mutate(candidate, issue);

		expect(isScanSnapshot(candidate)).toBe(false);
	});

	it("rejects unknown root fields", () => {
		const snapshot = createScanSnapshot(
			makeResult([makeIssue()], []),
			"profile",
			"0.5.0",
			100,
		) as unknown as Record<string, unknown>;
		snapshot.futureData = "must not be re-persisted";

		expect(isScanSnapshot(snapshot)).toBe(false);
	});

	it.each(["fixAction", "noteBody", "responseBody"])(
		"rejects unknown issue field %s",
		(field) => {
			const snapshot = createScanSnapshot(
				makeResult([makeIssue()], []),
				"profile",
				"0.5.0",
				100,
			) as unknown as Record<string, unknown>;
			const issue = (snapshot.issues as Array<Record<string, unknown>>)[0];
			issue[field] = { sensitive: true };

			expect(isScanSnapshot(snapshot)).toBe(false);
		},
	);

	it("rejects unknown explanation fields", () => {
		const snapshot = createScanSnapshot(
			makeResult([makeIssue()], []),
			"profile",
			"0.5.0",
			100,
		) as unknown as Record<string, unknown>;
		const issue = (snapshot.issues as Array<Record<string, unknown>>)[0];
		const explanation = issue.explanation as Record<string, unknown>;
		explanation.responseBody = "must not be re-persisted";

		expect(isScanSnapshot(snapshot)).toBe(false);
	});

	it.each(["root", "issue", "explanation"])(
		"rejects a non-plain JSON %s object",
		(location) => {
			const snapshot = createScanSnapshot(
				makeResult([makeIssue()], []),
				"profile",
				"0.5.0",
				100,
			) as unknown as Record<string, unknown>;
			const issue = (snapshot.issues as Array<Record<string, unknown>>)[0];
			let candidate: unknown = snapshot;

			if (location === "root") {
				candidate = Object.assign(Object.create({ inherited: true }), snapshot);
			} else if (location === "issue") {
				(snapshot.issues as unknown[])[0] = Object.assign(
					Object.create({ inherited: true }),
					issue,
				);
			} else {
				issue.explanation = Object.assign(
					Object.create({ inherited: true }),
					issue.explanation,
				);
			}

			expect(isScanSnapshot(candidate)).toBe(false);
		},
	);

	it("accepts arbitrary string evidence keys with scalar values", () => {
		const snapshot = createScanSnapshot(
			makeResult([makeIssue()], []),
			"profile",
			"0.5.0",
			100,
		) as unknown as Record<string, unknown>;
		const issue = (snapshot.issues as Array<Record<string, unknown>>)[0];
		const evidence = issue.evidence as Record<string, unknown>;
		evidence["arbitrary future key"] = "allowed";

		expect(isScanSnapshot(snapshot)).toBe(true);
	});

	it("rejects symbol evidence keys even when Object.values cannot see them", () => {
		const snapshot = createScanSnapshot(
			makeResult([makeIssue()], []),
			"profile",
			"0.5.0",
			100,
		) as unknown as Record<string, unknown>;
		const issue = (snapshot.issues as Array<Record<string, unknown>>)[0];
		const evidence = issue.evidence as Record<PropertyKey, unknown>;
		evidence[Symbol("hidden")] = { responseBody: "must not be persisted" };

		expect(isScanSnapshot(snapshot)).toBe(false);
	});

	it("rejects non-enumerable evidence values that are not scalar", () => {
		const snapshot = createScanSnapshot(
			makeResult([makeIssue()], []),
			"profile",
			"0.5.0",
			100,
		) as unknown as Record<string, unknown>;
		const issue = (snapshot.issues as Array<Record<string, unknown>>)[0];
		const evidence = issue.evidence as Record<string, unknown>;
		Object.defineProperty(evidence, "hidden", {
			value: { responseBody: "must not be persisted" },
			enumerable: false,
		});

		expect(isScanSnapshot(snapshot)).toBe(false);
	});

	it("rejects duplicate fingerprints as a corrupt snapshot", () => {
		const duplicate = makeIssue({ fingerprint: "same" });
		const snapshot = createScanSnapshot(
			makeResult([duplicate], [makeIssue({ fingerprint: "same" })]),
			"profile",
			"0.5.0",
			100,
		);

		expect(isScanSnapshot(snapshot)).toBe(false);
	});

	it("does not accept objects that only carry snapshot versions", () => {
		expect(isScanSnapshot({ schemaVersion: 1, comparisonVersion: 1 })).toBe(false);
	});
});
