# Automatic Stale Scan Implementation Plan (Milestone 3, Task 3.4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in stale-scan trigger. Two new settings — `automaticScanIntervalHours` (`0` disables, default) and `automaticScanNetworkChecks` (`false` default, separately gates the external-link scanner) — are classified as presentation-only in `src/scanner/scan-profile.ts` so they never change a detection-profile hash. A new pure module `src/scanner/scan-scheduler.ts` exposes `decideAutomaticScan` (the complete gate: `disabled` at interval ≤ 0, `busy` while an operation runs, `fresh` while `lastSuccessfulSnapshot.createdAt` is inside the interval, otherwise `run` — `null` snapshot counts as stale), `automaticScanSettings` (clone settings, force `enabledScanners["external-links"] = false` unless network checks are enabled — the effective scanner set flows through `enabledScanners` into the existing profile, so detection semantics stay in the profile), `confirmedNewIssues` (issues that are both `"new"` in the comparison and `classification === "confirmed"`, from `result.issues` only; `[]` when the comparison is unavailable), `automaticScanNotice` (the exact sentence `Vault Inspector automatic scan found N new confirmed issue(s).`), and `createStartupScanScheduler(deps)` (a closure with `scheduled` + `fired` guards so one activation performs at most one check; defers via `deps.whenSettled`, skips silently on any non-`run` reason, otherwise calls `deps.runAutomaticScan(automaticScanSettings(deps.getSettings()))` and notifies once only when a `completed` outcome has new confirmed errors — failures, persist warnings, and unavailable comparisons stay silent). `src/main.ts` schedules it once in `onload` (`whenSettled` → `this.app.workspace.onLayoutReady`), tracks operation occupancy (`operationRunning` set around every enqueued operation via a new `runOperation` wrapper) so `isBusy()` is accurate, and implements `runAutomaticScan` as `enqueueOperation(() => runScanSession(this.scanDeps(), settings, {}, "automatic"))` — read-only by structure: no fix pipeline, no report export, no view. The settings tab gains an "Automatic scanning" section (slider 0–168 hours, network-checks toggle). No scanner, fingerprint, `COMPARISON_VERSION`, snapshot/history shape, session, or CLI change.

**Architecture:** Dependency injection mirrors `scan-session.ts`: the scheduler module imports nothing from Obsidian and owns no timers — `whenSettled` is injected (Obsidian's `onLayoutReady` from `main.ts`), `now` is injected (testable staleness), and `notify` is injected (`Notice` stays in `main.ts`). Serialization stays in `main.ts`'s single `operationQueue`; the busy-skip is a synchronous read of `operationRunning` at settle time, so an automatic scan never queues behind an in-flight scan or mutation batch but is still itself enqueued (mutual exclusion with anything starting the same tick). Gating policy (`decideAutomaticScan`), settings adjustment, and notification content are separate pure functions so each roadmap behavior has a focused test.

**Tech Stack:** TypeScript, Obsidian Plugin API (main.ts only), Vitest

Design doc: `docs/superpowers/specs/2026-09-01-automatic-stale-scan-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 3, Task 3.4)

---

## Ground rules

- Branch: `feat/automatic-stale-scan`, cut from latest `main`.
- One commit: `feat: add opt-in stale vault scans`.
- The scheduler never executes fixes and never exports reports: its only lever is the injected `runAutomaticScan`, which main implements as `runScanSession(deps, settings, {}, "automatic")` — no `runFixBatch`, no `executeFixAction`, no `generateMarkdownReport`.
- The scheduler module must not import anything from `obsidian` (not even types) and must hold no timers. `Notice` construction stays in `src/main.ts` behind `deps.notify`.
- Scheduling settings are presentation-only: `automaticScanIntervalHours` and `automaticScanNetworkChecks` MUST be added to `PresentationOnlySettingKey` in `src/scanner/scan-profile.ts` — the `satisfies Record<DetectionSettingKey, unknown>` constraint fails the build otherwise. Never add them to the canonical profile object.
- The external-link exclusion is expressed ONLY through `enabledScanners` in a settings clone (`automaticScanSettings`); do not add scanner-set parameters to `runScanSession`, `ScanRunner.run`, or the profile function.
- Notify exactly once, only for a `completed` outcome with `confirmedNewIssues(...).length > 0`. Everything else — `failed`, `persistWarning`, unavailable comparison, `disabled`/`fresh`/`busy` skips — is silent.
- Deviation from the roadmap file list: `src/tests/main.test.ts` gains exactly one fixture line (`onLayoutReady: vi.fn()` in the fake workspace of "binds scan callbacks when Obsidian restores the inspector view") because `onload` now calls `this.app.workspace.onLayoutReady`. No assertion in that file changes.
- Do not modify `src/scanner/scanners/*`, `src/scanner/ScanRunner.ts`, `src/scanner/scan-session.ts`, `src/scanner/result-diff.ts`, `src/snapshot/*`, `src/report/*`, `src/fix/*`, `src/settings/plugin-data.ts`, `styles.css`, or `cli/*`.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.
- Never `eslint-disable` any `obsidianmd/*` rule.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/automatic-stale-scan
```

---

### Task 2: Write the failing settings and profile tests first (TDD)

**Files:**
- Modify: `src/tests/settings.test.ts`

- [ ] **Step 1: Add default and merge-preservation tests**

In `src/tests/settings.test.ts`, insert after the test `"defaults duplicate cleanup to always ask"` (which ends at line 30 with `});`):

```typescript
	it("keeps automatic scans off by default", () => {
		expect(DEFAULT_SETTINGS.automaticScanIntervalHours).toBe(0);
		expect(DEFAULT_SETTINGS.automaticScanNetworkChecks).toBe(false);
	});

	it("preserves persisted automatic scan settings", async () => {
		const plugin = new VaultInspectorPlugin({} as any, {} as any);
		plugin.loadData = vi.fn(async () => ({
			automaticScanIntervalHours: 24,
			automaticScanNetworkChecks: true,
		}));

		await plugin.loadSettings();

		expect(plugin.settings.automaticScanIntervalHours).toBe(24);
		expect(plugin.settings.automaticScanNetworkChecks).toBe(true);
	});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/settings.test.ts
```

Expected: FAIL — `automaticScanIntervalHours` does not exist on
`DEFAULT_SETTINGS` (TypeScript property error surfaces as a test failure),
pinning the missing type/default before implementation.

---

### Task 3: Add the settings and classify them as presentation-only

**Files:**
- Modify: `src/settings/settings.ts`
- Modify: `src/scanner/scan-profile.ts`

- [ ] **Step 1: Add the type fields**

In `src/settings/settings.ts`, replace (lines 21–23):

```typescript
	ignoredFoldersByScanner: Record<ScannerId, string[]>;
	ignoreUnresolvedNoteLinks: boolean;
	ignoredProperties: string[];
```

with:

```typescript
	ignoredFoldersByScanner: Record<ScannerId, string[]>;
	ignoreUnresolvedNoteLinks: boolean;
	ignoredProperties: string[];
	/** Hours after which a startup check may run one read-only scan. 0 disables. */
	automaticScanIntervalHours: number;
	/** Whether automatic scans may include the external-link scanner. */
	automaticScanNetworkChecks: boolean;
```

- [ ] **Step 2: Add the defaults**

In `src/settings/settings.ts`, replace (line 52):

```typescript
	ignoredProperties: [],
```

with:

```typescript
	ignoredProperties: [],
	automaticScanIntervalHours: 0,
	automaticScanNetworkChecks: false,
```

- [ ] **Step 3: Classify both keys as presentation-only**

In `src/scanner/scan-profile.ts`, replace (lines 7–12):

```typescript
type PresentationOnlySettingKey =
	| "enableFixActions"
	| "duplicateKeepMode"
	| "ignoredIssueFingerprints"
	| "reportFolderPath";
type DetectionSettingKey = Exclude<keyof InspectorSettings, PresentationOnlySettingKey>;
```

with:

```typescript
type PresentationOnlySettingKey =
	| "enableFixActions"
	| "duplicateKeepMode"
	| "ignoredIssueFingerprints"
	| "reportFolderPath"
	| "automaticScanIntervalHours"
	| "automaticScanNetworkChecks";
type DetectionSettingKey = Exclude<keyof InspectorSettings, PresentationOnlySettingKey>;
```

(No change to the canonical object in `createScanProfile` — the
`satisfies Record<DetectionSettingKey, unknown>` constraint proves at
compile time that scheduling settings never enter the profile hash.)

- [ ] **Step 4: Run the settings and profile suites**

```bash
npm test -- src/tests/settings.test.ts src/tests/scan-profile.test.ts
```

Expected: PASS — new settings tests green, and the existing
`scan-profile.test.ts` (including "ignores presentation-only settings" and
the per-setting change matrix) green without edits, proving the profile
hash is untouched.

---

### Task 4: Settings-tab section (test first, then UI)

**Files:**
- Modify: `src/tests/settings-tab.test.ts`
- Modify: `src/settings/settings-tab.ts`

- [ ] **Step 1: Extend the tab test**

In `src/tests/settings-tab.test.ts`, replace (lines 28–36):

```typescript
		expect(groups.map((group) => group.heading)).toEqual([
			"Enabled scanners",
			"Fix actions",
			"Thresholds",
			"Tags",
			"Ignored items",
			"Scanner-specific ignored folders",
			"Export",
		]);
```

with:

```typescript
		expect(groups.map((group) => group.heading)).toEqual([
			"Enabled scanners",
			"Automatic scanning",
			"Fix actions",
			"Thresholds",
			"Tags",
			"Ignored items",
			"Scanner-specific ignored folders",
			"Export",
		]);
```

and replace (lines 55–61):

```typescript
		expect(names).toEqual(expect.arrayContaining([
			"Enable fix actions",
			"Duplicate file keep mode",
			"Large Markdown threshold (kb)",
			"Duplicate hash cap (mb)",
			"Report folder",
		]));
```

with:

```typescript
		expect(namesByHeading.get("Automatic scanning")).toEqual([
			"Automatic scan interval (hours)",
			"Automatic scan network checks",
		]);
		expect(names).toEqual(expect.arrayContaining([
			"Enable fix actions",
			"Duplicate file keep mode",
			"Large Markdown threshold (kb)",
			"Duplicate hash cap (mb)",
			"Report folder",
		]));
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/settings-tab.test.ts
```

Expected: FAIL — the "Automatic scanning" heading and both names do not
exist yet.

- [ ] **Step 3: Add the section to the settings tab**

In `src/settings/settings-tab.ts`, insert after the closing of the
"Enabled scanners" section entry (line 84, the `},` following the
SCANNER_IDS map) and before the ` Fix actions` section:

```typescript
			{
				heading: "Automatic scanning",
				items: [
					{
						name: "Automatic scan interval (hours)",
						desc: "Run one read-only scan after startup when the last successful scan is older than this many hours. 0 disables automatic scans.",
						render: (setting) => {
							setting.addSlider((slider) =>
								slider.setLimits(0, 168, 1)
									.setValue(this.plugin.settings.automaticScanIntervalHours)
									.onChange(async (value) => {
										this.plugin.settings.automaticScanIntervalHours = value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
					{
						name: "Automatic scan network checks",
						desc: "Allow automatic scans to include the external link scanner. Off by default, so automatic scans never touch the network without a separate opt-in.",
						render: (setting) => {
							setting.addToggle((toggle) =>
								toggle.setValue(this.plugin.settings.automaticScanNetworkChecks)
									.onChange(async (value) => {
										this.plugin.settings.automaticScanNetworkChecks = value;
										await this.plugin.saveSettings();
									}),
							);
						},
					},
				],
			},
```

- [ ] **Step 4: Run the tab suite**

```bash
npm test -- src/tests/settings-tab.test.ts
```

Expected: PASS.

---

### Task 5: Write the failing scheduler tests first (TDD)

**Files:**
- Create: `src/tests/scan-scheduler.test.ts`

- [ ] **Step 1: Create `src/tests/scan-scheduler.test.ts` in full**

```typescript
import { describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SETTINGS,
	type InspectorSettings,
} from "../settings/settings";
import type { Issue, ScanResult } from "../scanner/Issue";
import type { LifecycleComparison } from "../scanner/result-diff";
import {
	createScanSnapshot,
	type ScanSnapshot,
} from "../snapshot/scan-snapshot";
import type { ScanSessionOutcome } from "../scanner/scan-session";
import {
	automaticScanNotice,
	automaticScanSettings,
	confirmedNewIssues,
	createStartupScanScheduler,
	decideAutomaticScan,
	type StartupScanSchedulerDeps,
} from "../scanner/scan-scheduler";

const HOUR_MS = 3_600_000;

function makeSettings(
	mutate: (settings: InspectorSettings) => void = () => {},
): InspectorSettings {
	const settings = structuredClone(DEFAULT_SETTINGS);
	mutate(settings);
	return settings;
}

function makeIssue(
	fingerprint: string,
	classification: Issue["classification"] = "confirmed",
): Issue {
	return {
		scannerId: "broken-links",
		severity: "warning",
		classification,
		explanation: {
			why: "Test evidence confirms this fixture.",
			nextStep: "Review the test fixture.",
		},
		title: fingerprint,
		message: fingerprint,
		primaryPath: `${fingerprint}.md`,
		relatedPaths: [],
		evidence: { target: fingerprint },
		fingerprint,
	};
}

function makeResult(issues: Issue[], ignoredIssues: Issue[] = []): ScanResult {
	return {
		startedAt: 0,
		finishedAt: 1,
		issues,
		ignoredIssues,
		filesScanned: 1,
		scannersRun: ["broken-links", "empty-notes"],
	};
}

function makeSnapshot(createdAt: number): ScanSnapshot {
	return createScanSnapshot(makeResult([]), "current-profile", "0.6.0", createdAt);
}

function makeComparison(
	statuses: Map<string, "new" | "persisting">,
	available = true,
): LifecycleComparison {
	return {
		available,
		...(available ? {} : { reason: "settings-changed" as const }),
		statuses,
		resolvedIssues: [],
	};
}

function completedOutcome(
	issues: Issue[],
	statuses: Map<string, "new" | "persisting">,
	available = true,
): ScanSessionOutcome {
	return {
		status: "completed",
		result: makeResult(issues),
		comparison: makeComparison(statuses, available),
	};
}

describe("decideAutomaticScan", () => {
	it("stays disabled at the default interval of zero", () => {
		expect(decideAutomaticScan({
			settings: makeSettings(),
			snapshot: makeSnapshot(0),
			now: 10 * 24 * HOUR_MS,
			busy: false,
		})).toEqual({ run: false, reason: "disabled" });
	});

	it("treats negative intervals as disabled", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = -1; }),
			snapshot: makeSnapshot(0),
			now: 10 * 24 * HOUR_MS,
			busy: false,
		})).toEqual({ run: false, reason: "disabled" });
	});

	it("skips while an operation is active even when stale", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = 24; }),
			snapshot: makeSnapshot(0),
			now: 10 * 24 * HOUR_MS,
			busy: true,
		})).toEqual({ run: false, reason: "busy" });
	});

	it("skips while the last successful scan is fresh", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = 24; }),
			snapshot: makeSnapshot(23 * HOUR_MS),
			now: 24 * HOUR_MS,
			busy: false,
		})).toEqual({ run: false, reason: "fresh" });
	});

	it("runs when the last successful scan is exactly the interval old", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = 24; }),
			snapshot: makeSnapshot(0),
			now: 24 * HOUR_MS,
			busy: false,
		})).toEqual({ run: true });
	});

	it("runs when there is no snapshot yet", () => {
		expect(decideAutomaticScan({
			settings: makeSettings((s) => { s.automaticScanIntervalHours = 1; }),
			snapshot: null,
			now: 0,
			busy: false,
		})).toEqual({ run: true });
	});
});

describe("automaticScanSettings", () => {
	it("excludes the external-link scanner by default", () => {
		const adjusted = automaticScanSettings(makeSettings((s) => {
			s.enabledScanners["external-links"] = true;
		}));

		expect(adjusted.enabledScanners["external-links"]).toBe(false);
	});

	it("keeps the external-link scanner when network checks are enabled", () => {
		const adjusted = automaticScanSettings(makeSettings((s) => {
			s.enabledScanners["external-links"] = true;
			s.automaticScanNetworkChecks = true;
		}));

		expect(adjusted.enabledScanners["external-links"]).toBe(true);
	});

	it("never mutates the given settings and keeps other scanners intact", () => {
		const original = makeSettings((s) => {
			s.enabledScanners["external-links"] = true;
			s.enabledScanners["broken-links"] = false;
		});
		const before = structuredClone(original);

		const adjusted = automaticScanSettings(original);

		expect(original).toEqual(before);
		expect(adjusted).not.toBe(original);
		expect(adjusted.enabledScanners["broken-links"]).toBe(false);
		expect(adjusted.enabledScanners["empty-notes"]).toBe(
			original.enabledScanners["empty-notes"],
		);
	});
});

describe("confirmedNewIssues", () => {
	it("counts only new confirmed issues from the active result", () => {
		const current = makeIssue("current");
		const persisting = makeIssue("persisting");
		const candidate = makeIssue("candidate", "candidate");
		const unverified = makeIssue("unverified", "unverified");
		const result = makeResult([current, persisting, candidate, unverified]);

		const issues = confirmedNewIssues(
			result,
			makeComparison(new Map([
				[current.fingerprint, "new"],
				[persisting.fingerprint, "persisting"],
				[candidate.fingerprint, "new"],
				[unverified.fingerprint, "new"],
			])),
		);

		expect(issues.map((issue) => issue.fingerprint)).toEqual(["current"]);
	});

	it("ignores ignored findings even when they are new", () => {
		const ignored = makeIssue("ignored");
		const result = makeResult([], [ignored]);

		const issues = confirmedNewIssues(
			result,
			makeComparison(new Map([[ignored.fingerprint, "new"]])),
		);

		expect(issues).toEqual([]);
	});

	it("returns nothing when the comparison is unavailable", () => {
		const current = makeIssue("current");

		expect(confirmedNewIssues(
			makeResult([current]),
			makeComparison(new Map([[current.fingerprint, "new"]]), false),
		)).toEqual([]);
	});
});

describe("automaticScanNotice", () => {
	it("uses the singular form for one issue", () => {
		expect(automaticScanNotice([makeIssue("only")]))
			.toBe("Vault Inspector automatic scan found 1 new confirmed issue.");
	});

	it("uses the plural form for several issues", () => {
		expect(automaticScanNotice([makeIssue("a"), makeIssue("b")]))
			.toBe("Vault Inspector automatic scan found 2 new confirmed issues.");
	});
});

function makeSchedulerDeps(options: {
	settings?: InspectorSettings;
	snapshot?: ScanSnapshot | null;
	now?: number;
	busy?: boolean;
	outcome?: ScanSessionOutcome;
} = {}) {
	let settings = options.settings ?? makeSettings((s) => {
		s.automaticScanIntervalHours = 24;
	});
	const runAutomaticScan = vi.fn(async () =>
		options.outcome ?? completedOutcome([], new Map()),
	);
	const whenSettled = vi.fn((run: () => void) => { settleCallbacks.push(run); });
	const settleCallbacks: Array<() => void> = [];
	const notifications: string[] = [];
	const deps: StartupScanSchedulerDeps = {
		getSettings: () => settings,
		getSnapshot: () => options.snapshot ?? null,
		isBusy: () => options.busy ?? false,
		now: () => options.now ?? 48 * HOUR_MS,
		whenSettled,
		runAutomaticScan,
		notify: (message) => notifications.push(message),
	};
	return {
		deps,
		runAutomaticScan,
		notifications,
		settle: () => { for (const run of settleCallbacks.splice(0)) run(); },
		setSettings: (next: InspectorSettings) => { settings = next; },
	};
}

describe("createStartupScanScheduler", () => {
	it("defers the check until the workspace settles", () => {
		const subject = makeSchedulerDeps();
		const scheduler = createStartupScanScheduler(subject.deps);

		scheduler.schedule();

		expect(subject.runAutomaticScan).not.toHaveBeenCalled();
		subject.settle();
		expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1);
	});

	it("skips silently when disabled, fresh, or busy", () => {
		const disabled = makeSchedulerDeps({
			settings: makeSettings(),
		});
		createStartupScanScheduler(disabled.deps).schedule();
		disabled.settle();
		expect(disabled.runAutomaticScan).not.toHaveBeenCalled();

		const fresh = makeSchedulerDeps({
			snapshot: makeSnapshot(47 * HOUR_MS),
			now: 48 * HOUR_MS,
		});
		createStartupScanScheduler(fresh.deps).schedule();
		fresh.settle();
		expect(fresh.runAutomaticScan).not.toHaveBeenCalled();

		const busy = makeSchedulerDeps({ busy: true });
		createStartupScanScheduler(busy.deps).schedule();
		busy.settle();
		expect(busy.runAutomaticScan).not.toHaveBeenCalled();

		expect(disabled.notifications).toEqual([]);
	});

	it("runs with scheduler-adjusted settings that exclude network checks", async () => {
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			settings: makeSettings((s) => {
				s.automaticScanIntervalHours = 24;
				s.enabledScanners["external-links"] = true;
			}),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		const passed = subject.runAutomaticScan.mock.calls[0][0];
		expect(passed).not.toBe(subject.deps.getSettings());
		expect(passed.enabledScanners["external-links"]).toBe(false);
	});

	it("schedules only once per activation even if settle fires again", () => {
		const subject = makeSchedulerDeps({ snapshot: makeSnapshot(0) });
		const scheduler = createStartupScanScheduler(subject.deps);

		scheduler.schedule();
		scheduler.schedule();
		expect(subject.runAutomaticScan).not.toHaveBeenCalled();
		subject.settle();
		subject.settle();

		expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1);
	});

	it("reads the settings at fire time", () => {
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			settings: makeSettings(),
		});
		const scheduler = createStartupScanScheduler(subject.deps);

		scheduler.schedule();
		subject.setSettings(makeSettings((s) => {
			s.automaticScanIntervalHours = 24;
		}));
		subject.settle();

		expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1);
	});

	it("notifies once when a completed scan finds new confirmed errors", async () => {
		const fresh = makeIssue("fresh");
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: completedOutcome(
				[fresh],
				new Map([[fresh.fingerprint, "new"]]),
			),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.notifications.length).toBe(1),
		);

		expect(subject.notifications).toEqual([
			"Vault Inspector automatic scan found 1 new confirmed issue.",
		]);
	});

	it("stays silent when no finding is newly confirmed", async () => {
		const persisting = makeIssue("persisting");
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: completedOutcome(
				[persisting],
				new Map([[persisting.fingerprint, "persisting"]]),
			),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		expect(subject.notifications).toEqual([]);
	});

	it("stays silent when the comparison is unavailable", async () => {
		const current = makeIssue("current");
		const subject = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: completedOutcome(
				[current],
				new Map([[current.fingerprint, "new"]]),
				false,
			),
		});
		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		expect(subject.notifications).toEqual([]);
	});

	it("stays silent when the scan fails or persistence warns", async () => {
		const failed = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: { status: "failed", message: "scanner exploded" },
		});
		createStartupScanScheduler(failed.deps).schedule();
		failed.settle();
		await vi.waitFor(() =>
			expect(failed.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		const warned = makeSchedulerDeps({
			snapshot: makeSnapshot(0),
			outcome: {
				status: "completed",
				result: makeResult([makeIssue("current")]),
				comparison: makeComparison(
					new Map([["current", "new" as const]]),
				),
				persistWarning: "disk unavailable",
			},
		});
		createStartupScanScheduler(warned.deps).schedule();
		warned.settle();
		await vi.waitFor(() =>
			expect(warned.runAutomaticScan).toHaveBeenCalledTimes(1),
		);

		expect(failed.notifications).toEqual([]);
		expect(warned.notifications).toEqual([]);
	});

	it("swallows a rejecting automatic scan without an unhandled rejection", async () => {
		const subject = makeSchedulerDeps({ snapshot: makeSnapshot(0) });
		subject.runAutomaticScan.mockRejectedValueOnce(new Error("queue unavailable"));

		createStartupScanScheduler(subject.deps).schedule();
		subject.settle();
		await vi.waitFor(() =>
			expect(subject.runAutomaticScan).toHaveBeenCalledTimes(1),
		);
		await Promise.resolve();

		expect(subject.notifications).toEqual([]);
	});
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/scan-scheduler.test.ts
```

Expected: FAIL — `../scanner/scan-scheduler` does not exist, so the suite
fails to resolve the import (that is the expected red).

---

### Task 6: Create `src/scanner/scan-scheduler.ts`

**Files:**
- Create: `src/scanner/scan-scheduler.ts`

- [ ] **Step 1: Create the file in full**

```typescript
import type { InspectorSettings } from "../settings/settings";
import type { Issue, ScanResult } from "./Issue";
import type { LifecycleComparison } from "./result-diff";
import type { ScanSessionOutcome } from "./scan-session";
import type { ScanSnapshot } from "../snapshot/scan-snapshot";

const HOUR_MS = 3_600_000;

export type AutomaticScanDecision =
	| { run: true }
	| { run: false; reason: "disabled" | "fresh" | "busy" };

/**
 * Complete gating policy for the startup check: interval <= 0 disables,
 * an active scan or mutation batch skips, a last successful scan inside
 * the interval is fresh, and a missing snapshot counts as stale.
 */
export function decideAutomaticScan(input: {
	settings: InspectorSettings;
	snapshot: ScanSnapshot | null;
	now: number;
	busy: boolean;
}): AutomaticScanDecision {
	const intervalMs = input.settings.automaticScanIntervalHours * HOUR_MS;
	if (intervalMs <= 0) return { run: false, reason: "disabled" };
	if (input.busy) return { run: false, reason: "busy" };
	if (
		input.snapshot !== null
		&& input.now - input.snapshot.createdAt < intervalMs
	) {
		return { run: false, reason: "fresh" };
	}
	return { run: true };
}

/**
 * Clones the settings for one automatic scan and excludes the
 * external-link scanner unless network checks are separately enabled.
 * The exclusion is expressed through enabledScanners so the effective
 * scanner set stays part of the detection profile.
 */
export function automaticScanSettings(
	settings: InspectorSettings,
): InspectorSettings {
	const scanSettings = structuredClone(settings);
	if (!scanSettings.automaticScanNetworkChecks) {
		scanSettings.enabledScanners["external-links"] = false;
	}
	return scanSettings;
}

/**
 * Active, non-ignored findings that are both newly detected and
 * confirmed. Anything else — persisting, candidate, unverified, ignored,
 * or compared against an unavailable baseline — is not worth a notice.
 */
export function confirmedNewIssues(
	result: ScanResult,
	comparison: LifecycleComparison,
): Issue[] {
	if (!comparison.available) return [];
	return result.issues.filter((issue) =>
		comparison.statuses.get(issue.fingerprint) === "new"
		&& issue.classification === "confirmed");
}

export function automaticScanNotice(newIssues: Issue[]): string {
	const count = newIssues.length;
	return `Vault Inspector automatic scan found ${count} new confirmed issue${count === 1 ? "" : "s"}.`;
}

export type StartupScanSchedulerDeps = {
	getSettings: () => InspectorSettings;
	getSnapshot: () => ScanSnapshot | null;
	isBusy: () => boolean;
	now: () => number;
	whenSettled: (run: () => void) => void;
	runAutomaticScan: (settings: InspectorSettings) => Promise<ScanSessionOutcome>;
	notify: (message: string) => void;
};

export type StartupScanScheduler = { schedule: () => void };

/**
 * One-shot startup trigger. schedule() registers at most one settle
 * callback per activation, and the fired guard keeps the check itself to
 * at most one run even if the settle signal is delivered twice. Skips
 * stay silent; only a completed scan with new confirmed errors notifies.
 */
export function createStartupScanScheduler(
	deps: StartupScanSchedulerDeps,
): StartupScanScheduler {
	let scheduled = false;
	let fired = false;
	return {
		schedule() {
			if (scheduled) return;
			scheduled = true;
			deps.whenSettled(() => {
				if (fired) return;
				fired = true;
				const decision = decideAutomaticScan({
					settings: deps.getSettings(),
					snapshot: deps.getSnapshot(),
					now: deps.now(),
					busy: deps.isBusy(),
				});
				if (!decision.run) return;
				void deps
					.runAutomaticScan(automaticScanSettings(deps.getSettings()))
					.then((outcome) => {
						if (outcome.status !== "completed") return;
						const newIssues = confirmedNewIssues(
							outcome.result,
							outcome.comparison,
						);
						if (newIssues.length > 0) {
							deps.notify(automaticScanNotice(newIssues));
						}
					})
					.catch(() => {
						// Automatic scans are best-effort; failures stay silent.
					});
			});
		},
	};
}
```

- [ ] **Step 2: Run the scheduler tests**

```bash
npm test -- src/tests/scan-scheduler.test.ts
```

Expected: PASS.

---

### Task 7: Wire the scheduler into `src/main.ts`

**Files:**
- Modify: `src/main.ts`
- Modify: `src/tests/main.test.ts`

- [ ] **Step 1: Update the imports**

In `src/main.ts`, after (lines 25–31):

```typescript
import {
	acceptScanResult,
	runScanOperation,
	runScanSession,
	type ScanDeps,
	type ScanSessionHooks,
} from "./scanner/scan-session";
```

add:

```typescript
import {
	createStartupScanScheduler,
	type StartupScanScheduler,
} from "./scanner/scan-scheduler";
```

- [ ] **Step 2: Add the plugin fields**

In `src/main.ts`, replace (lines 39–40):

```typescript
	private saveQueue: Promise<void> = Promise.resolve();
	private operationQueue: Promise<void> = Promise.resolve();
```

with:

```typescript
	private saveQueue: Promise<void> = Promise.resolve();
	private operationQueue: Promise<void> = Promise.resolve();
	private operationRunning = false;
	private startupScanScheduler: StartupScanScheduler | null = null;
```

- [ ] **Step 3: Schedule the startup check in `onload`**

In `src/main.ts`, replace (lines 70–73):

```typescript
		registerDefaultScanners(this.scanRunner);
		this.addSettingTab(new InspectorSettingTab(this.app, this));

		this.addRibbonIcon("shield-check", "Run scan", () => this.runScan());
```

with:

```typescript
		registerDefaultScanners(this.scanRunner);
		this.addSettingTab(new InspectorSettingTab(this.app, this));

		this.startupScanScheduler = createStartupScanScheduler({
			getSettings: () => this.settings,
			getSnapshot: () => this.lastSuccessfulSnapshot,
			isBusy: () => this.operationRunning,
			now: () => Date.now(),
			whenSettled: (run) => this.app.workspace.onLayoutReady(run),
			runAutomaticScan: (settings) =>
				this.enqueueOperation(() =>
					runScanSession(this.scanDeps(), settings, {}, "automatic")),
			notify: (message) => new Notice(message),
		});
		this.startupScanScheduler.schedule();

		this.addRibbonIcon("shield-check", "Run scan", () => this.runScan());
```

- [ ] **Step 4: Track operation occupancy in `enqueueOperation`**

In `src/main.ts`, replace (lines 349–355):

```typescript
	private enqueueOperation(operation: () => Promise<void>): Promise<void> {
		const run = this.operationQueue
			.catch(() => undefined)
			.then(operation);
		this.operationQueue = run.catch(() => undefined);
		return run;
	}
```

with:

```typescript
	private enqueueOperation(operation: () => Promise<void>): Promise<void> {
		const run = this.operationQueue
			.catch(() => undefined)
			.then(() => this.runOperation(operation));
		this.operationQueue = run.catch(() => undefined);
		return run;
	}

	private async runOperation(operation: () => Promise<void>): Promise<void> {
		this.operationRunning = true;
		try {
			await operation();
		} finally {
			this.operationRunning = false;
		}
	}
```

- [ ] **Step 5: Extend the fake workspace in `main.test.ts` (the one fixture-line deviation)**

In `src/tests/main.test.ts`, inside the test
"binds scan callbacks when Obsidian restores the inspector view", replace
(around lines 588–593):

```typescript
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => [leaf]),
				revealLeaf: vi.fn(async () => {}),
			},
```

with:

```typescript
		const app = {
			workspace: {
				getLeavesOfType: vi.fn(() => [leaf]),
				revealLeaf: vi.fn(async () => {}),
				onLayoutReady: vi.fn(),
			},
```

(`onLayoutReady` is a non-invoking mock: `onload` registers the startup
check but no scan fires in this test — and with the default interval of 0
the decision would be `disabled` anyway.)

- [ ] **Step 6: Run the focused suites**

```bash
npm test -- src/tests/scan-scheduler.test.ts src/tests/main.test.ts
```

Expected: PASS — all `main.test.ts` tests green with only the fixture line
added, plus the new scheduler suite. If any other main test fails, STOP:
the wiring changed behavior; fix the wiring, never the pinned test.

---

### Task 8: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/scan-scheduler.test.ts src/tests/settings.test.ts src/tests/settings-tab.test.ts src/tests/main.test.ts
```

Expected: PASS — default installations remain manual, automatic scans are
bounded and read-only, and network checks require separate opt-in.

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0, zero ESLint warnings, build regenerates usable
`main.js` and `cli.js`, full suite green.

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/scanner/scan-scheduler.ts`, `src/tests/scan-scheduler.test.ts`,
`src/settings/settings.ts`, `src/settings/settings-tab.ts`,
`src/scanner/scan-profile.ts`, `src/main.ts`, `src/tests/settings.test.ts`,
`src/tests/settings-tab.test.ts`, and the one fixture block in
`src/tests/main.test.ts`. NOT `src/scanner/scanners/*`,
`src/scanner/ScanRunner.ts`, `src/scanner/scan-session.ts`,
`src/scanner/result-diff.ts`, `src/snapshot/*`, `src/report/*`, `src/fix/*`,
`styles.css`, or `cli/*`.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/scan-scheduler.ts src/tests/scan-scheduler.test.ts \
  src/settings/settings.ts src/settings/settings-tab.ts \
  src/scanner/scan-profile.ts src/main.ts \
  src/tests/settings.test.ts src/tests/settings-tab.test.ts \
  src/tests/main.test.ts
git commit -m "feat: add opt-in stale vault scans"
git push -u origin feat/automatic-stale-scan
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `feat: add opt-in stale vault scans`, covering: two new presentation-only
  settings (`automaticScanIntervalHours: 0` disables and is the default;
  `automaticScanNetworkChecks: false` default) classified in
  `PresentationOnlySettingKey` so profile hashes are unchanged; new
  `src/scanner/scan-scheduler.ts` (`decideAutomaticScan` /
  `automaticScanSettings` / `confirmedNewIssues` / `automaticScanNotice` /
  `createStartupScanScheduler`) gating one read-only scan per activation
  after `onLayoutReady`, only when the last successful snapshot is older
  than the interval, skipped while an operation runs, excluding
  external links unless separately enabled, notifying only on new
  confirmed errors, otherwise persisting silently via the existing
  `runScanSession(..., "automatic")` acceptance path; `src/main.ts` adds
  `operationRunning` occupancy tracking and the startup wiring; settings
  tab gains the "Automatic scanning" section; the one-line
  `main.test.ts` fixture deviation (fake workspace gains `onLayoutReady`)
  documented with evidence; no fix execution, no report export, no CLI
  change. Include the roadmap PR-description items: focused tests run,
  full verification results, non-goals, compatibility impact, and
  remaining boundaries.

## Self-review checklist (completed during plan writing)

- Roadmap Task 3.4 requirement ↔ implementation mapping: `automaticScanIntervalHours` `0` disables and is default ✓ (Task 3 `DEFAULT_SETTINGS` + Task 2 test "keeps automatic scans off by default"); `automaticScanNetworkChecks` `false` default and gates the external-link scanner ✓ (Task 6 `automaticScanSettings` flips only `enabledScanners["external-links"]`); schedule one startup check after the workspace settles ✓ (Task 7 `onload` → `schedule()` once → `deps.whenSettled` → `app.workspace.onLayoutReady`); run only when the last successful scan is older than the interval ✓ (Task 6 `decideAutomaticScan` reads `snapshot.createdAt`, boundary `>=` runs, `null` snapshot runs); never more than once per activation ✓ (`scheduled` + `fired` guards, pinned by "schedules only once per activation even if settle fires again"); skip while another scan or mutation is active ✓ (`operationRunning` around every `enqueueOperation` body + `busy` decision, pinned by "skips while an operation is active even when stale" and "skips silently when disabled, fresh, or busy"); never execute fixes or export reports ✓ (the scheduler's only lever is `runScanSession`; no `runFixBatch`/`executeFixAction`/`generateMarkdownReport` import exists in `scan-scheduler.ts`); exclude external links unless separately enabled ✓; notify only on new confirmed errors from a completed scan, otherwise silent persistence ✓ (`confirmedNewIssues` + four silence tests: no-new, unavailable comparison, failed, persistWarning); scheduling settings are presentation/orchestration inputs while the effective scanner set stays in the profile ✓ (Task 3 `PresentationOnlySettingKey` + `satisfies Record<DetectionSettingKey, unknown>` compile enforcement; `scan-profile.test.ts` "ignores presentation-only settings" still passes unedited).
- No placeholders: Task 6 is a complete file; Task 5 is a complete test file; Tasks 3, 4, and 7 quote exact current code before every replacement with line anchors.
- Type/name consistency verified against real code: `ScanSessionOutcome` shape matches `src/scanner/scan-session.ts` lines 50–57 (the `persistWarning` test constructs it literally); `LifecycleComparison` matches `src/scanner/result-diff.ts` lines 15–22 (`available`, optional `reason`, `statuses`, `resolvedIssues` — the unavailable fixture omits `previousScanAt`, which is optional); `createScanSnapshot(result, profile, toolVersion, createdAt)` matches `src/snapshot/scan-snapshot.ts` line 43; `Issue` fixture fields match `src/tests/scan-session.test.ts`'s `makeIssue`; `enabledScanners` is `Record<ScannerId, boolean>` so the `"external-links"` assignment type-checks; `enqueueOperation` change preserves the exact queue chaining (`this.operationQueue = run.catch(...)`) pinned by "serializes complete scan flows through snapshot persistence" and "persists each accepted candidate instead of reading a later global candidate"; `runScanSession(deps, settings, {}, "automatic")` matches the merged Task 3.3 signature (`scan-session.ts` line 69).
- Scanner-set exclusion stays in detection semantics: the exclusion is expressed ONLY as `enabledScanners["external-links"] = false` inside a settings clone, so `createScanProfile` and `compareScanResult` need zero changes; when the user's manual set differs, the comparison reports `settings-changed` (existing deliberate behavior — "Profile changes never mark every issue as new or resolved") and the automatic scan persists silently.
- `main.test.ts` impact audited: only "binds scan callbacks when Obsidian restores the inspector view" calls `onload`, and only its fake workspace lacks `onLayoutReady`; `makeScanSubject`/`makeContextualSubject` drive the plugin through existing methods without `onload`, so no other fixture needs the method; default interval 0 keeps every existing flow manual even if a settle callback fired.
- Sentence-case UI strings: "Automatic scanning" heading, "Automatic scan interval (hours)", "Automatic scan network checks" — matching the existing tab style ("Enable fix actions", "Report folder"); notice sentence ends with a period like the existing "…exported to …" notices.
- obsidianmd lint constraints: `scan-scheduler.ts` imports nothing from `obsidian` (not even types); `onLayoutReady` and `Notice` stay in `main.ts`; no `eslint-disable`.
- Precision-suite/CLI impact: none — `scanner-precision.test.ts` observes scanners (untouched), `cli/` untouched, fingerprints, `COMPARISON_VERSION`, snapshot/history shapes unchanged; `scan-profile.test.ts` passes unedited, proving the profile hash is byte-identical for existing settings.
