# Scan History Implementation Plan (Milestone 3, Task 3.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist bounded scan-summary history alongside the existing last-successful snapshot. A new pure module `src/snapshot/scan-history.ts` owns `ScanHistoryEntry` (creation time, tool version, scan profile, comparison version, `manual`/`automatic` trigger, files scanned, scanners run, active/ignored/new/persisting/resolved totals, severity and classification counts over active issues), `createScanHistoryEntry` (counts lifecycle totals from the `LifecycleComparison` that `acceptScanResult` already computes; zeros when comparison is unavailable), `appendScanHistoryEntry` (newest-first, capped at `MAX_HISTORY_ENTRIES = 20`), `isScanHistoryEntry` (strict per-entry validation), and `parseScanHistory` (non-array → `[]`; filter invalid entries individually, then keep the newest twenty valid). `src/settings/plugin-data.ts` evolves the envelope with an optional `scanHistory` key: legacy flat settings and non-record data parse with an empty history; an invalid history never discards settings or the snapshot. `src/main.ts` appends exactly one entry per accepted scan inside `acceptScanResult`, persisting snapshot and history in ONE `persistPluginData` call whose in-memory commit happens only after `saveData` resolves — so failed/incomplete scans append nothing, and a failed save rolls history back with the snapshot. No issue lists are stored beyond the single snapshot; no scanner, diff, fingerprint, `COMPARISON_VERSION`, settings-shape, report, fix, or CLI change.

**Architecture:** Entry creation/validation lives in `scan-history.ts` because entries summarize what `ScanResult` + `LifecycleComparison` already produce and share nothing structurally with `ScanSnapshot` (whose module is untouched). The append lives in `acceptScanResult` (`src/main.ts`) because it is the single acceptance path shared by manual scans and the fix batch's final verification; `persistPluginData`'s serialized write queue already provides the atomic write-and-commit boundary both values need. `trigger: "automatic"` exists in the type now but no producer passes it in this PR (Task 3.4 introduces it); every existing caller uses the `"manual"` default.

**Tech Stack:** TypeScript, Vitest, plain-object persistence fixtures

Design doc: `docs/superpowers/specs/2026-09-01-scan-history-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 3, Task 3.1)

---

## Ground rules

- Branch: `feat/scan-history`, cut from latest `main`.
- One commit: `feat: persist bounded scan summary history`.
- History entries contain ONLY the roadmap's summary fields — never fingerprints, evidence, or issue objects. No second complete issue list is ever stored.
- At most twenty valid entries survive, newest-first, both at append time (`appendScanHistoryEntry`) and at load time (`parseScanHistory` filters invalid entries first, THEN truncates).
- History parsing never throws and never affects the settings or snapshot branches of `parsePluginData`.
- Only accepted successful scans append history: the append lives inside `acceptScanResult`, after the comparison and render, in the same `persistPluginData` call as the snapshot. A failed scan run, a null result, or a failed save appends nothing.
- The persisted `scanHistory` key is omitted when the history is empty (mirrors the existing `lastSuccessfulSnapshot` key omission).
- Do not modify `src/scanner/*`, `src/report/*`, `src/fix/*`, `src/settings/settings.ts`, `src/settings/settings-tab.ts`, `src/snapshot/scan-snapshot.ts`, `styles.css`, or `cli/*`.
- Deviation from the roadmap file list: `src/snapshot/scan-snapshot.ts` and `src/tests/scan-snapshot.test.ts` are NOT modified (the snapshot module needs no change — `compareScanResult` in `src/scanner/result-diff.ts` already computes the lifecycle totals entries record); `src/tests/main.test.ts` IS modified (one pinned exact-equality assertion gains the persisted `scanHistory` key, plus one new acceptance test).
- Never `eslint-disable` any `obsidianmd/*` rule.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/scan-history
```

---

### Task 2: Write the failing tests first (TDD)

**Files:**
- Create: `src/tests/scan-history.test.ts`
- Modify: `src/tests/plugin-data.test.ts`
- Modify: `src/tests/main.test.ts`

- [ ] **Step 1: Create `src/tests/scan-history.test.ts` with the full suite**

```typescript
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
		expect(parsed[0].createdAt).toBe(MAX_HISTORY_ENTRIES - 1);
		expect(parsed[MAX_HISTORY_ENTRIES - 1].createdAt).toBe(0);
	});
});
```

- [ ] **Step 2: Replace `src/tests/plugin-data.test.ts` in full**

Every existing expectation gains `scanHistory: []` (the parsed envelope always
carries a history array), and new tests pin history parsing, invalid-entry
discard, and legacy compatibility. Replace the entire file with:

```typescript
import { describe, expect, it } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import { COMPARISON_VERSION, createScanSnapshot } from "../snapshot/scan-snapshot";
import type { ScanHistoryEntry } from "../snapshot/scan-history";
import { parsePluginData } from "../settings/plugin-data";

function makeSnapshot() {
	const issue: Issue = {
		scannerId: "broken-links",
		severity: "error",
		classification: "confirmed",
		title: "Broken link",
		message: "Missing target",
		primaryPath: "Source.md",
		relatedPaths: ["Missing.md"],
		evidence: { linkText: "Missing" },
		explanation: {
			why: "The target does not exist.",
			nextStep: "Update or remove the link.",
		},
		fingerprint: "broken-link-1",
	};
	const result: ScanResult = {
		startedAt: 1,
		finishedAt: 2,
		issues: [issue],
		ignoredIssues: [],
		filesScanned: 1,
		scannersRun: ["broken-links"],
	};
	return createScanSnapshot(result, "profile-1", "0.5.0", 100);
}

function makeHistoryEntry(createdAt: number): ScanHistoryEntry {
	return {
		schemaVersion: 1,
		createdAt,
		toolVersion: "0.7.0",
		scanProfile: "profile-1",
		comparisonVersion: COMPARISON_VERSION,
		trigger: "manual",
		filesScanned: 2,
		scannersRun: ["broken-links"],
		totals: {
			active: 1,
			ignored: 0,
			newIssues: 1,
			persistingIssues: 0,
			resolvedIssues: 0,
		},
		severityCounts: { error: 1, warning: 0, info: 0 },
		classificationCounts: { confirmed: 1, candidate: 0, unverified: 0 },
	};
}

describe("parsePluginData", () => {
	it("treats a flat settings object as legacy plugin data with empty history", () => {
		const value = {
			largeMarkdownBytes: 2048,
			enabledScanners: { "broken-links": false },
		};

		expect(parsePluginData(value)).toEqual({
			settings: value,
			lastSuccessfulSnapshot: null,
			scanHistory: [],
			legacy: true,
		});
	});

	it("parses a valid settings and snapshot envelope without history", () => {
		const settings = { reportFolderPath: "Reports" };
		const lastSuccessfulSnapshot = makeSnapshot();

		expect(parsePluginData({ settings, lastSuccessfulSnapshot })).toEqual({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [],
			legacy: false,
		});
	});

	it("parses history entries from the envelope", () => {
		const settings = { reportFolderPath: "Reports" };
		const lastSuccessfulSnapshot = makeSnapshot();
		const newest = makeHistoryEntry(2);
		const oldest = makeHistoryEntry(1);

		expect(parsePluginData({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [newest, oldest],
		})).toEqual({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [newest, oldest],
			legacy: false,
		});
	});

	it("discards invalid history entries without discarding settings or the snapshot", () => {
		const settings = { ignoredFolders: ["Archive"] };
		const lastSuccessfulSnapshot = makeSnapshot();
		const valid = makeHistoryEntry(2);

		expect(parsePluginData({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [valid, { schemaVersion: 1 }, null],
		})).toEqual({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [valid],
			legacy: false,
		});
	});

	it("treats a non-array scanHistory as empty without affecting the envelope", () => {
		const settings = { reportFolderPath: "Reports" };
		const lastSuccessfulSnapshot = makeSnapshot();

		expect(parsePluginData({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: "corrupted",
		})).toEqual({
			settings,
			lastSuccessfulSnapshot,
			scanHistory: [],
			legacy: false,
		});
	});

	it("discards only an invalid snapshot from an otherwise valid envelope", () => {
		const settings = { ignoredFolders: ["Archive"] };

		expect(parsePluginData({
			settings,
			lastSuccessfulSnapshot: { schemaVersion: 1 },
		})).toEqual({
			settings,
			lastSuccessfulSnapshot: null,
			scanHistory: [],
			legacy: false,
		});
	});

	it.each([null, undefined, "settings", 7, [], true])(
		"treats non-record data %j as empty legacy data",
		(value) => {
			expect(parsePluginData(value)).toEqual({
				settings: {},
				lastSuccessfulSnapshot: null,
				scanHistory: [],
				legacy: true,
			});
		},
	);

	it("preserves a structurally valid snapshot from another comparison version", () => {
		const snapshot = makeSnapshot();
		snapshot.comparisonVersion = COMPARISON_VERSION + 1;

		expect(parsePluginData({ settings: {}, lastSuccessfulSnapshot: snapshot }))
			.toEqual({
				settings: {},
				lastSuccessfulSnapshot: snapshot,
				scanHistory: [],
				legacy: false,
			});
	});

	it("discards a snapshot with an unsupported schema version", () => {
		const snapshot = makeSnapshot() as unknown as Record<string, unknown>;
		snapshot.schemaVersion = 2;

		expect(parsePluginData({ settings: {}, lastSuccessfulSnapshot: snapshot }))
			.toEqual({
				settings: {},
				lastSuccessfulSnapshot: null,
				scanHistory: [],
				legacy: false,
			});
	});

	it("discards a snapshot with unknown fields", () => {
		const snapshot = makeSnapshot() as unknown as Record<string, unknown>;
		snapshot.responseBody = "must not be persisted";

		expect(parsePluginData({ settings: {}, lastSuccessfulSnapshot: snapshot }))
			.toEqual({
				settings: {},
				lastSuccessfulSnapshot: null,
				scanHistory: [],
				legacy: false,
			});
	});
});
```

- [ ] **Step 3: Update the pinned assertion and add the acceptance test in `src/tests/main.test.ts`**

In the "accepts and persists a first completed scan without lifecycle
statuses" test (lines 135–159), replace (lines 154–158):

```typescript
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(saveData).toHaveBeenCalledWith({
			settings: plugin.settings,
			lastSuccessfulSnapshot: plugin.lastSuccessfulSnapshot,
		});
```

with:

```typescript
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(saveData).toHaveBeenCalledWith({
			settings: plugin.settings,
			lastSuccessfulSnapshot: plugin.lastSuccessfulSnapshot,
			scanHistory: [expect.objectContaining({
				toolVersion: "0.5.0",
				scanProfile: "current-profile",
				trigger: "manual",
			})],
		});
		expect(plugin.scanHistory).toHaveLength(1);
```

Then append a new test immediately after that test (before "clears old
operation outcomes when an ordinary queued scan starts"):

```typescript
	it("appends one history entry per accepted scan and none for failed scans", async () => {
		const result = makeScanResult([makeLifecycleIssue("current")]);
		const { plugin, run, saveData, view } = makeScanSubject(result);
		plugin.lastSuccessfulSnapshot = makeSnapshot("current-profile");

		await (plugin as any).scanAndRender(view);

		expect(plugin.scanHistory).toHaveLength(1);
		expect(plugin.scanHistory[0]).toMatchObject({
			trigger: "manual",
			scanProfile: "current-profile",
			totals: {
				active: 1,
				ignored: 0,
				newIssues: 1,
				persistingIssues: 0,
				resolvedIssues: 0,
			},
		});

		run.mockRejectedValueOnce(new Error("scanner exploded"));
		await (plugin as any).scanAndRender(view);

		expect(plugin.scanHistory).toHaveLength(1);
		expect(saveData).toHaveBeenCalledTimes(1);
	});
```

(The pre-existing snapshot with profile `current-profile` and no issues makes
the single `current` finding `new`; the failed second scan must neither append
an entry nor write.)

- [ ] **Step 4: Run and confirm failure**

```bash
npm test -- src/tests/scan-history.test.ts src/tests/plugin-data.test.ts src/tests/main.test.ts
```

Expected: FAIL — `src/snapshot/scan-history` does not exist (unresolvable
import), every `parsePluginData` expectation is missing the `scanHistory`
key, and `plugin.scanHistory` is undefined.

---

### Task 3: Implement `src/snapshot/scan-history.ts`

**Files:**
- Create: `src/snapshot/scan-history.ts`

- [ ] **Step 1: Create the module with the full contents**

```typescript
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
	return value.filter(isScanHistoryEntry).slice(0, MAX_HISTORY_ENTRIES);
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
```

- [ ] **Step 2: Run the history tests**

```bash
npm test -- src/tests/scan-history.test.ts
```

Expected: PASS — all new tests green (the module now exists; `plugin-data`
and `main` tests still fail until Tasks 4–5).

---

### Task 4: Evolve the envelope in `src/settings/plugin-data.ts`

**Files:**
- Modify: `src/settings/plugin-data.ts`

- [ ] **Step 1: Replace the whole file with the history-aware version**

```typescript
import type { InspectorSettings } from "./settings";
import { isScanSnapshot, type ScanSnapshot } from "../snapshot/scan-snapshot";
import { parseScanHistory, type ScanHistoryEntry } from "../snapshot/scan-history";

export type PersistedPluginData = {
	settings: InspectorSettings;
	lastSuccessfulSnapshot?: ScanSnapshot;
	scanHistory?: ScanHistoryEntry[];
};

export type ParsedPluginData = {
	settings: Partial<InspectorSettings>;
	lastSuccessfulSnapshot: ScanSnapshot | null;
	scanHistory: ScanHistoryEntry[];
	legacy: boolean;
};

export function parsePluginData(value: unknown): ParsedPluginData {
	if (!isRecord(value)) {
		return {
			settings: {},
			lastSuccessfulSnapshot: null,
			scanHistory: [],
			legacy: true,
		};
	}

	if (isRecord(value.settings)) {
		return {
			settings: value.settings,
			lastSuccessfulSnapshot: isScanSnapshot(value.lastSuccessfulSnapshot)
				? value.lastSuccessfulSnapshot
				: null,
			scanHistory: parseScanHistory(value.scanHistory),
			legacy: false,
		};
	}

	return {
		settings: value,
		lastSuccessfulSnapshot: null,
		scanHistory: [],
		legacy: true,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 2: Run the plugin-data tests**

```bash
npm test -- src/tests/plugin-data.test.ts src/tests/scan-snapshot.test.ts
```

Expected: PASS — the snapshot suite passes unmodified (that module is
untouched).

---

### Task 5: Append history in the acceptance path in `src/main.ts`

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the imports and the plugin field**

After the existing snapshot import block (lines 22–25), add:

```typescript
import {
	appendScanHistoryEntry,
	createScanHistoryEntry,
	type ScanHistoryEntry,
	type ScanTrigger,
} from "./snapshot/scan-history";
```

After the `lastSuccessfulSnapshot` field declaration (line 34), add:

```typescript
	scanHistory: ScanHistoryEntry[] = [];
```

- [ ] **Step 2: Load the history in `loadSettings`**

In `loadSettings`, replace (line 89):

```typescript
		this.lastSuccessfulSnapshot = parsed.lastSuccessfulSnapshot;
```

with:

```typescript
		this.lastSuccessfulSnapshot = parsed.lastSuccessfulSnapshot;
		this.scanHistory = parsed.scanHistory;
```

- [ ] **Step 3: Persist and commit history atomically in `persistPluginData`**

Replace the whole `persistPluginData` method (lines 100–119) with:

```typescript
	private persistPluginData(options?: {
		acceptedSnapshot?: ScanSnapshot;
		acceptedHistory?: ScanHistoryEntry[];
		settings?: InspectorSettings;
	}): Promise<void> {
		const write = this.saveQueue.catch(() => undefined).then(async () => {
			const snapshot = options?.acceptedSnapshot ?? this.lastSuccessfulSnapshot;
			const history = options?.acceptedHistory ?? this.scanHistory;
			const data: PersistedPluginData = {
				settings: structuredClone(options?.settings ?? this.settings),
				...(snapshot
					? { lastSuccessfulSnapshot: structuredClone(snapshot) }
					: {}),
				...(history.length > 0
					? { scanHistory: structuredClone(history) }
					: {}),
			};
			await this.saveData(data);
			if (options?.acceptedSnapshot) {
				this.lastSuccessfulSnapshot = options.acceptedSnapshot;
			}
			if (options?.acceptedHistory) {
				this.scanHistory = options.acceptedHistory;
			}
		});
		this.saveQueue = write;
		return write;
	}
```

The `scanHistory` key is omitted when the history is empty, so
`saveSettings`-only tests and a fresh install's persisted shape are
unchanged.

- [ ] **Step 4: Append one entry per accepted scan in `acceptScanResult`**

Replace the whole `acceptScanResult` method (lines 360–385) with:

```typescript
	private async acceptScanResult(
		view: InspectorView,
		result: ScanResult,
		scanProfile: string,
		trigger: ScanTrigger = "manual",
	) {
		const comparison = compareScanResult(
			result,
			this.lastSuccessfulSnapshot,
			scanProfile,
		);
		view.setResult(result, comparison);

		const nextSnapshot = createScanSnapshot(
			result,
			scanProfile,
			this.manifest.version,
		);
		const nextHistory = appendScanHistoryEntry(
			this.scanHistory,
			createScanHistoryEntry({
				result,
				comparison,
				scanProfile,
				toolVersion: this.manifest.version,
				trigger,
			}),
		);
		try {
			await this.persistPluginData({
				acceptedSnapshot: nextSnapshot,
				acceptedHistory: nextHistory,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(
				`Scan completed, but the comparison snapshot could not be saved: ${message}`,
			);
		}
	}
}
```

No existing `acceptScanResult` caller changes: both call sites
(`performScanAndRender`, `onFixAllIssues`) omit `trigger` and default to
`"manual"`. The `trigger` parameter exists so Task 3.4 can pass
`"automatic"` without touching this acceptance path again.

- [ ] **Step 5: Run the main-suite tests**

```bash
npm test -- src/tests/main.test.ts
```

Expected: PASS — all existing tests (including the two envelope-shape tests
at lines 1326–1341 and 1365–1377, whose subjects have empty histories and
therefore omit the key) plus the two updated/new acceptance assertions.

---

### Task 6: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/scan-history.test.ts src/tests/plugin-data.test.ts src/tests/scan-snapshot.test.ts
```

Expected: PASS — persistence is backward compatible, bounded, and updated
only after accepted successful scans.

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0, zero ESLint warnings, build regenerates usable
`main.js` and `cli.js`.

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/snapshot/scan-history.ts`, `src/settings/plugin-data.ts`,
`src/main.ts`, `src/tests/scan-history.test.ts`,
`src/tests/plugin-data.test.ts`, and `src/tests/main.test.ts`. NOT
`src/snapshot/scan-snapshot.ts`, `src/scanner/*`, `src/report/*`,
`src/fix/*`, `src/settings/settings.ts`, `src/settings/settings-tab.ts`,
`styles.css`, or `cli/*`.

- [ ] **Step 4: Commit and push**

```bash
git add src/snapshot/scan-history.ts src/settings/plugin-data.ts src/main.ts src/tests/scan-history.test.ts src/tests/plugin-data.test.ts src/tests/main.test.ts
git commit -m "feat: persist bounded scan summary history"
git push -u origin feat/scan-history
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `feat: persist bounded scan summary history`, covering: at most twenty
  compact summary entries (creation time, tool version, scan profile,
  comparison version, manual/automatic trigger, files scanned, scanners run,
  active/ignored/new/persisting/resolved totals, severity and classification
  counts) stored alongside the single last-successful snapshot — no second
  issue list; newest-twenty-valid-entries bound enforced at append and load;
  invalid entries discarded individually without touching settings or the
  snapshot; legacy flat settings and the envelope both parse; history
  appended only in `acceptScanResult` after a successful scan, persisted and
  committed atomically with the snapshot (failed scans and failed saves
  append nothing); deviations from the roadmap file list documented
  (`scan-snapshot.ts`/its tests untouched; `main.test.ts` updated for the
  pinned envelope assertion and one new acceptance test); no scanner, diff,
  fingerprint, `COMPARISON_VERSION`, settings-shape, report, fix, or CLI
  changes.

## Self-review checklist (completed during plan writing)

- Roadmap Task 3.1 checkbox ↔ implementation mapping: entry field list ✓ (Task 3 `createScanHistoryEntry` — `createdAt`/`toolVersion`, `scanProfile`/`comparisonVersion` (current `COMPARISON_VERSION = 2` from `src/snapshot/scan-snapshot.ts` line 18), `trigger: "manual" | "automatic"`, `filesScanned`/`scannersRun` from `ScanResult` (`src/scanner/Issue.ts` lines 82–89), totals, severity/classification counts); no multiple complete issue lists ✓ (entry carries only scalars + the `scannersRun` id list; the single `lastSuccessfulSnapshot` remains the only issue list); keep the newest twenty valid entries ✓ (`appendScanHistoryEntry` prepends + `slice(0, 20)`; `parseScanHistory` filters invalid THEN truncates, so an invalid entry cannot push a valid one out of bounds — pinned by the "keeps only the newest twenty valid entries" test); parse legacy flat settings and the current envelope ✓ (Task 4: legacy and non-record branches return `scanHistory: []`; envelope branch parses `value.scanHistory`); discard invalid entries without discarding valid settings or the snapshot ✓ (history parsing is independent of the `settings`/`lastSuccessfulSnapshot` branches and never throws — pinned by the discard and non-array tests); failed/incomplete scans do not append or replace ✓ (append lives in `acceptScanResult`, reached only for non-null results; `persistPluginData` commits history in memory only after `saveData` resolves, riding the exact rollback semantics the existing "keeps a completed result visible, rolls back a failed snapshot save" and "leaves the accepted baseline untouched when scanning fails" tests pin — extended to history by the new main test).
- Lifecycle totals match what the codebase already computes: `compareScanResult` (`src/scanner/result-diff.ts` lines 22–59) populates `statuses` for active AND ignored findings (ignored stay active in lifecycle comparison) and returns `resolvedIssues`; `countStatus` counts map values and `resolvedIssues.length` is used only when `available`, so unavailable comparisons (first-scan / settings-changed / semantics-changed) record zeros — the exact semantics `acceptScanResult` already renders.
- Append placement: `acceptScanResult` (`src/main.ts` lines 360–385) is the single acceptance path shared by `performScanAndRender` (line 353) and the fix batch's verification result (`onFixAllIssues`, lines 218–229); the fix flow's `acceptanceFailed` rethrow still sees the same Notice-based soft failure — the new history write is inside the same try/catch as the snapshot write, so both roll back together.
- Deviations documented: `src/snapshot/scan-snapshot.ts` and `src/tests/scan-snapshot.test.ts` NOT modified (roadmap listed them, but `createScanSnapshot`/`isScanSnapshot` need no change and the diff summary lives in `result-diff.ts`); `src/tests/main.test.ts` IS modified (the pinned exact-equality `saveData` assertion at lines 154–158 cannot survive the new key, plus one new test).
- No placeholders: Tasks 3 and 4 are complete replacement files; Task 5 quotes the exact current code before replacement (verified against `src/main.ts` lines 22–25, 34, 89, 100–119, 360–385); Task 2's test files are complete and file-ready, including the full `plugin-data.test.ts` replacement with `scanHistory: []` added to every expectation.
- Type/name consistency verified: `ScanResult.issues`/`ignoredIssues`/`filesScanned`/`scannersRun` match `src/scanner/Issue.ts`; `LifecycleComparison.available`/`statuses`/`resolvedIssues` match `src/scanner/result-diff.ts`; `SCANNER_IDS` is exported from `Issue.ts` (line 105); `COMPARISON_VERSION` is exported from `scan-snapshot.ts`; `PersistedPluginData`/`ParsedPluginData`/`parsePluginData` match `src/settings/plugin-data.ts`; `main.test.ts` fixtures (`makeScanSubject` with `manifest.version: "0.5.0"` and `createScanProfileMock` resolving `"current-profile"`, `makeLifecycleIssue`, `makeSnapshot`) match the real helpers at lines 1616–1656; no import cycle (`scan-history` → `result-diff` + `scan-snapshot`; `plugin-data` → `scan-snapshot` + `scan-history`; neither reverse edge exists).
- Envelope compatibility: the `scanHistory` key is omitted when empty, so `main.test.ts`'s "saves settings in an envelope without an absent snapshot key" (empty history) and "migrates the legacy key inside an envelope without losing its snapshot" tests pass unmodified; only the first-scan acceptance assertion changes.
- obsidianmd lint constraints: `scan-history.ts` and `plugin-data.ts` are Obsidian-free pure modules (no imports from `obsidian`); `structuredClone` is the platform global already used in `main.ts`; no `innerHTML`, no `eslint-disable`, no new UI strings.
- Precision-suite/CLI impact: none — `src/tests/scanner-precision.test.ts` observes scanner behavior (untouched); `cli/` never reads plugin `data.json` and no stable CLI field moves; `compareScanResult`, fingerprints, and `COMPARISON_VERSION` are unchanged.
