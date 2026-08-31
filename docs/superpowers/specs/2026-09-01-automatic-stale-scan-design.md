# Automatic Stale Scan Design (Milestone 3, Task 3.4)

Date: 2026-09-01
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 3, Task 3.4)
Predecessors: `docs/superpowers/specs/2026-09-01-scan-session-design.md` (Task 3.3, merged — `runScanSession` in `src/scanner/scan-session.ts` completes a full scan headless with NO hooks, persists snapshot + history, and already accepts a `trigger: ScanTrigger` that `createScanHistoryEntry` records as `"automatic"`), `docs/superpowers/specs/2026-09-01-scan-history-design.md` (Task 3.1, merged — history entries carry `trigger: "manual" | "automatic"`), and `docs/superpowers/specs/2026-08-31-changes-first-summary-design.md` (Task 3.2, merged — `LifecycleComparison.previousScanAt`)

## Problem

Every scan today is user-initiated: the user must remember to open the report
and run a scan. A vault that has not been scanned for weeks silently drifts
while its persisted snapshot (`lastSuccessfulSnapshot`) grows stale. Task 3.3
removed the technical blocker — `runScanSession(deps, settings, {}, "automatic")`
runs a complete scan, compares, accepts, and persists without any
`InspectorView` — but nothing ever calls it. There is no trigger, no setting,
and no bound on what such a trigger may do.

The roadmap's requirement: an opt-in stale-scan trigger. Two new settings —
`automaticScanIntervalHours` (`0` disables, and is the default) and
`automaticScanNetworkChecks` (`false` default, separately gates whether an
automatic scan may include the external-link scanner). After the workspace
settles, the plugin runs at most one check per activation: skip unless the
last successful scan is older than the interval, skip while another scan or
mutation is active, run the scan read-only (never fixes, never report
exports), exclude external links unless separately enabled, and notify only
when a completed automatic scan finds new confirmed errors — otherwise update
persistence silently.

## Goals

The roadmap's required behavior, restated as where each guarantee lives:

- **Schedule one startup check after the workspace settles** — `src/main.ts`
  calls `createStartupScanScheduler(deps).schedule()` once in `onload`. The
  scheduler defers the check to `deps.whenSettled`, which main wires to
  Obsidian's `this.app.workspace.onLayoutReady` — the platform's own
  "workspace has settled" signal (layout built, leaves restored). No timers,
  no intervals, no polling.
- **Run only when the last successful scan is older than the interval** — the
  staleness source of truth is `deps.getSnapshot()`, main's
  `lastSuccessfulSnapshot`. The scan runs when there is no snapshot yet, or
  when `now - snapshot.createdAt >= automaticScanIntervalHours * 3_600_000`.
  A snapshot younger than the interval yields `fresh` and no scan.
- **Never run more than once per plugin activation** — the scheduler closure
  keeps two booleans: `scheduled` (a second `schedule()` call is a no-op) and
  `fired` (even if the settle callback were somehow delivered twice, the
  check runs at most once). One activation = at most one automatic scan.
- **Skip while another scan or mutation is active** — main tracks operation
  occupancy: `enqueueOperation` sets `operationRunning = true` for the
  duration of every enqueued operation (manual scans, fix batches, ignore /
  restore / exclude dispositions) and the scheduler reads it via
  `deps.isBusy()`. A busy queue at settle time means SKIP this activation —
  the automatic scan never queues behind a long fix batch. After the
  busy-skip, the automatic scan itself runs through `enqueueOperation`, so
  the existing serialized boundary still guarantees mutual exclusion with
  anything that started in the same tick.
- **Never execute fixes or export reports** — the scheduler's only lever is
  `deps.runAutomaticScan(settings)`, which main implements as
  `enqueueOperation(() => runScanSession(this.scanDeps(), settings, {}, "automatic"))`.
  `runScanSession` scans, compares, accepts, and persists; it has no code
  path to `runFixBatch`, `executeFixAction`, or `generateMarkdownReport`.
  The guarantee is structural, not behavioral discipline.
- **Exclude external links unless network checks are separately enabled** —
  `automaticScanSettings(settings)` clones the settings and forces
  `enabledScanners["external-links"] = false` unless
  `automaticScanNetworkChecks` is `true`. Detection semantics stay where
  they already live: the effective scanner set flows through
  `enabledScanners` into `createScanProfile`, so the profile hash — and
  therefore comparison compatibility — reflects the scanner set that
  actually ran.
- **Notify only when a completed automatic scan finds new confirmed errors;
  otherwise update persistence silently** — after a `completed` outcome, the
  scheduler counts issues that are BOTH `"new"` in
  `comparison.statuses` AND `classification === "confirmed"` among
  `result.issues` (ignored findings and candidate/unverified findings never
  notify). Count > 0 produces exactly one notice:
  `Vault Inspector automatic scan found N new confirmed issue(s).` Failed
  scans, persist warnings, and unavailable comparisons stay silent — the
  session already persisted or rolled back; a background scan must never
  nag the user about infrastructure.
- **Scheduling settings are presentation/orchestration inputs, not
  detection-profile inputs** — `automaticScanIntervalHours` and
  `automaticScanNetworkChecks` are added to `PresentationOnlySettingKey` in
  `src/scanner/scan-profile.ts`, joining `enableFixActions`,
  `duplicateKeepMode`, `ignoredIssueFingerprints`, and `reportFolderPath`.
  The `satisfies Record<DetectionSettingKey, unknown>` constraint makes this
  compile-time enforced: an unclassified new settings key fails the build.
  Changing either scheduling setting never changes the profile hash, never
  invalidates a baseline, and never marks findings new/resolved.

### Interpretation decisions (documented, not accidental)

- **"New confirmed errors" = `classification === "confirmed"` + lifecycle
  status `"new"`**, counted over `result.issues` only. "Confirmed" is the
  codebase's precision term for a verified finding (`FindingClassification`);
  ignored findings (`result.ignoredIssues`) are excluded because the user
  already dismissed them. Severity does not filter the count — a confirmed
  warning is still a real, verified problem the user has never seen.
- **No snapshot = stale.** A user who enables the interval on a vault that
  has never been scanned gets exactly one background scan that establishes
  the baseline. That first scan's comparison is unavailable
  (`first-scan`), `confirmedNewIssues` returns `[]`, so it persists silently
  — no notification on a baseline-establishing scan.
- **Differing effective scanner sets produce a `settings-changed`
  comparison, by existing design.** When the user enables the external-link
  scanner for manual scans but leaves `automaticScanNetworkChecks` off,
  automatic scans run with a different effective scanner set and therefore a
  different profile hash; `compareScanResult` then reports
  `reason: "settings-changed"` rather than guessing new/resolved — the exact
  behavior Task 3.2 built for any profile change ("Profile changes never
  mark every issue as new or resolved"). Such an automatic scan persists
  silently (comparison unavailable → no new findings → no notice) and the
  next manual scan replaces the baseline. Automatic-to-automatic scans
  compare normally because they share one effective set.
- **Busy at settle time = skip, not queue.** The roadmap says "skip while
  another scan or mutation is active"; deferring would turn a startup check
  into a delayed surprise scan minutes later.

## Non-goals (this PR)

- No background scheduling beyond the single startup check — no recurring
  timers, no "scan every N hours while Obsidian runs", no file-watch
  triggers. Changing the settings mid-session does not schedule anything;
  the new value applies from the next activation.
- No fix execution, no report export, no view opening, no progress UI, and
  no `Notice` on anything except new confirmed errors from a completed scan.
- No change to `ScanRunner`, scanners, `ScanContext`, fingerprints,
  `COMPARISON_VERSION`, snapshot shape, history shape, or `runScanSession`
  itself — the scheduler is a pure consumer of the Task 3.3 session.
- No change to `parsePluginData` / persistence envelope: the two new
  settings ride the existing `Partial<InspectorSettings>` deep merge in
  `loadSettings`, defaulting correctly for old `data.json` files.
- No CLI change: `cli/` reuse of scanners is untouched; the trigger is an
  Obsidian-workspace concept.

## Design

### Module shape: `src/scanner/scan-scheduler.ts`

```ts
export type AutomaticScanDecision =
	| { run: true }
	| { run: false; reason: "disabled" | "fresh" | "busy" };

export function decideAutomaticScan(input: {
	settings: InspectorSettings;
	snapshot: ScanSnapshot | null;
	now: number;
	busy: boolean;
}): AutomaticScanDecision;

export function automaticScanSettings(settings: InspectorSettings): InspectorSettings;

export function confirmedNewIssues(
	result: ScanResult,
	comparison: LifecycleComparison,
): Issue[];

export function automaticScanNotice(newIssues: Issue[]): string;

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

export function createStartupScanScheduler(
	deps: StartupScanSchedulerDeps,
): StartupScanScheduler;
```

Pure functions plus one small closure, mirroring the session's
dependency-injection style:

1. **`decideAutomaticScan`** — the complete gating policy in one pure
   function: `intervalHours <= 0` → `disabled`; `busy` → `busy`;
   snapshot exists and `now - snapshot.createdAt < intervalMs` → `fresh`;
   otherwise `run`. Testable without any scheduler machinery.
2. **`automaticScanSettings`** — `structuredClone(settings)` then force
   `enabledScanners["external-links"] = false` unless
   `automaticScanNetworkChecks`. The clone guarantees the plugin's live
   settings (and therefore the user's next manual scan) are untouched.
3. **`confirmedNewIssues`** — `comparison.available ? [] : …` guard, then
   filter `result.issues` for `statuses.get(fingerprint) === "new" &&
   classification === "confirmed"`. Ignored issues are not in
   `result.issues`, so they cannot notify.
4. **`automaticScanNotice`** — the exact user-facing sentence with correct
   singular/plural. Notice construction stays in `main.ts` via
   `deps.notify`.
5. **`createStartupScanScheduler`** — the orchestration closure described in
   Goals: `schedule()` once, defer via `whenSettled`, `fired` guard, decide,
   skip silently on any non-`run` reason, otherwise
   `deps.runAutomaticScan(automaticScanSettings(deps.getSettings()))` and,
   on a `completed` outcome with `confirmedNewIssues(...).length > 0`, one
   `deps.notify(automaticScanNotice(...))`. The returned promise is
   `.catch`-guarded: an automatic scan is best-effort and must never produce
   an unhandled rejection during startup.

### How `src/main.ts` wires it

In `onload`, after the settings tab registration:

```ts
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
```

`enqueueOperation` gains occupancy tracking — set `operationRunning = true`
before the operation body, clear it in `finally`:

```ts
private async runOperation(operation: () => Promise<void>): Promise<void> {
	this.operationRunning = true;
	try {
		await operation();
	} finally {
		this.operationRunning = false;
	}
}

private enqueueOperation(operation: () => Promise<void>): Promise<void> {
	const run = this.operationQueue
		.catch(() => undefined)
		.then(() => this.runOperation(operation));
	this.operationQueue = run.catch(() => undefined);
	return run;
}
```

No `enqueueOperation` call site changes; every existing serialized flow now
also reports occupancy. `onunload` needs no change: the scheduler holds no
timer, and `onLayoutReady` callbacks belong to Obsidian's workspace
lifecycle.

### Settings

`src/settings/settings.ts` gains two fields with defaults that keep every
existing installation fully manual:

```ts
automaticScanIntervalHours: number;   // default 0 = disabled
automaticScanNetworkChecks: boolean;  // default false
```

Old `data.json` files load through the existing
`{ ...DEFAULT_SETTINGS, ...loaded }` merge — missing keys default, present
values persist; no migration. Per the repo convention (type + default +
ScanContext field is not needed here because scanners never read these —
they are orchestration inputs consumed only by the scheduler and main).

`src/settings/settings-tab.ts` gains one new section, "Automatic scanning"
(after "Enabled scanners"), with sentence-case names matching the tab's
existing style:

- **"Automatic scan interval (hours)"** — slider, limits 0–168, step 1.
  Desc: "Run one read-only scan after startup when the last successful scan
  is older than this many hours. 0 disables automatic scans."
- **"Automatic scan network checks"** — toggle. Desc: "Allow automatic scans
  to include the external link scanner. Off by default, so automatic scans
  never touch the network without a separate opt-in."

### Profile classification

`src/scanner/scan-profile.ts` adds both keys to
`PresentationOnlySettingKey`:

```ts
type PresentationOnlySettingKey =
	| "enableFixActions"
	| "duplicateKeepMode"
	| "ignoredIssueFingerprints"
	| "reportFolderPath"
	| "automaticScanIntervalHours"
	| "automaticScanNetworkChecks";
```

The `satisfies Record<DetectionSettingKey, unknown>` on the canonical object
is the enforcement mechanism: adding a settings key without classifying it
fails `npm run build`. Note the deliberate asymmetry —
`automaticScanNetworkChecks` never changes the profile, but the effective
scanner set it produces (via `automaticScanSettings` flipping
`enabledScanners["external-links"]`) does, exactly as the roadmap requires
("the effective scanner set remains part of the profile").

## Documented deviations from the roadmap file list

- `src/tests/main.test.ts` IS modified — exactly one fixture line. The test
  "binds scan callbacks when Obsidian restores the inspector view" calls
  `plugin.onload()` with a hand-rolled fake `app` whose `workspace` lacks
  `onLayoutReady`; the new `whenSettled` wiring needs
  `onLayoutReady: vi.fn()` added to that fake workspace (a non-invoking
  mock, so no scan fires in the test). The roadmap's file list omitted
  `main.test.ts`, but the fixture must gain the method the real API provides.
  No test assertion changes.

## Test strategy

`src/tests/scan-scheduler.test.ts` (new, pure doubles — no Obsidian
mocking):

- `decideAutomaticScan`: `disabled` at interval 0; `busy` wins over
  staleness; `fresh` inside the interval (boundary: exactly the interval is
  stale — `>=` runs); `run` when the snapshot is older; `run` when the
  snapshot is `null`; negative interval treated as disabled.
- `automaticScanSettings`: disables `external-links` by default; keeps it
  when `automaticScanNetworkChecks` is `true`; never mutates the passed
  settings (deep-freeze style assertion on the original); leaves every other
  scanner and detection setting untouched.
- `confirmedNewIssues`: counts only `new` + `confirmed` from
  `result.issues`; skips `candidate`/`unverified`, skips persisting issues,
  skips ignored findings, returns `[]` when the comparison is unavailable.
- `automaticScanNotice`: singular/plural sentence forms.
- `createStartupScanScheduler`: defers until `whenSettled` fires; runs the
  scan with scheduler-adjusted settings when stale; skips silently on
  `disabled`/`fresh`/`busy`; `schedule()` twice fires `whenSettled`
  registration once; a second settle delivery never re-runs; notifies once
  with the exact sentence on completed-with-new-confirmed; stays silent on
  completed-without-new, on `failed`, and on `persistWarning`; swallows a
  rejecting `runAutomaticScan` (no unhandled rejection); reads settings at
  fire time (interval changed between `schedule()` and settle is honored).

`src/tests/settings.test.ts` (extend): defaults keep automatic scans off
(`0` / `false`); persisted values survive the deep merge.

`src/tests/settings-tab.test.ts` (extend): the headings list gains
"Automatic scanning" and the name assertions gain both new setting names.

`src/tests/main.test.ts`: one fixture line (see deviations) plus the
existing 65 tests as the integration pin — default settings keep every
existing flow manual.

## Verification strategy

```bash
npm test -- src/tests/scan-scheduler.test.ts src/tests/settings.test.ts src/tests/settings-tab.test.ts src/tests/main.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: default installations remain manual (all pre-existing tests pass
unchanged except the one fixture line), automatic scans are bounded
(once per activation, gated by staleness and busyness) and read-only, and
network checks require the separate opt-in.

## Precision-suite and CLI impact

None. Scanner behavior, fingerprints, `COMPARISON_VERSION`, snapshot and
history shapes, and `cli/` are untouched. The precision suite observes
scanners only. The scheduler lives under `src/scanner/` but imports nothing
from Obsidian at all (only types from sibling modules), keeping the
obsidian-warning lint surface clean. No stable CLI field moves; the CLI has
no workspace concept and never schedules.

## Risks

- **Differing profiles between automatic and manual scans** when the user
  enables the external-link scanner manually but not for automatic scans:
  comparisons across those scans report `settings-changed` instead of
  new/resolved. This is the existing, deliberate behavior for any effective
  scanner-set change (Milestone 3 acceptance: "Profile changes never mark
  every issue as new or resolved"), and the default installation
  (external links off) never hits it. Documented above so it is a decision.
- **Busy-skip loses one activation's check.** If Obsidian restores into an
  in-flight operation at settle time, no automatic scan runs until the next
  activation. Acceptable: the trigger is best-effort by design, and queueing
  behind a fix batch would be worse.
- **`onLayoutReady` after unload.** Obsidian does not deliver layout-ready
  after a plugin unloads; the scheduler holds no resources regardless. If a
  future host delivers it anyway, the scan it starts is still read-only and
  serialized.
- **Notification wording drift.** The exact sentence is pinned by
  `automaticScanNotice` tests so the user-facing string cannot silently
  change.
