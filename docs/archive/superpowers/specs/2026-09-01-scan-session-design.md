# Scan Session Design (Milestone 3, Task 3.3)

Date: 2026-09-01
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 3, Task 3.3)
Predecessors: `docs/superpowers/specs/2026-09-01-scan-history-design.md` (Task 3.1, merged — `acceptScanResult` in `src/main.ts` appends one history entry per accepted scan) and `docs/superpowers/specs/2026-09-01-changes-first-summary-design.md` (Task 3.2, merged — `LifecycleComparison.previousScanAt` is produced by `compareScanResult` on every snapshot-bearing branch)

## Problem

Every scan today is hard-wired to a live `InspectorView`. `performScanAndRender`
(`src/main.ts`) clones settings, creates the profile, calls `this.scan(view, …)`
— which flips `view.setScanning(true)` and forwards progress to
`view.setScanProgress` — then `acceptScanResult(view, …)` calls
`view.setResult` before persisting the snapshot and history. A scan cannot
start, progress, complete, or be accepted without a view instance, even though
the actual detection work (`ScanRunner.run`) needs only an `App`. Task 3.4's
opt-in stale-scan trigger needs to run a scan with the report view closed and
update persistence through exactly the same acceptance path as a manual scan;
today that is impossible without faking a view.

The roadmap's requirement: a `src/scanner/scan-session.ts` module that clones
settings and creates the scan profile, runs one scan through the existing
serialized operation boundary, publishes optional progress events, compares
and accepts successful results, persists snapshot and summary history, and
returns a result without requiring an open `InspectorView` — while manual
scans still open and update the report view, headless scans can complete
without creating a view, only one scan or mutation batch runs at a time, and a
failed progress consumer cannot convert a completed scan into a failed
detection result.

## Goals

The roadmap's required behavior, restated as where each guarantee lives:

- **Clone settings and create the scan profile** — `runScanSession` performs
  `structuredClone(settings)` once and passes that same immutable clone to
  both `deps.createProfile` and `deps.runner.run`, exactly matching today's
  `performScanAndRender` (`src/main.ts` lines 364–367, pinned by
  "uses one immutable settings snapshot for profile creation and scanning").
- **Run one scan through the existing serialized operation boundary** — the
  serialized boundary (`enqueueOperation` over `operationQueue`,
  `src/main.ts` lines 355–361) STAYS in `src/main.ts`. The session is a
  synchronous-once unit of work that main enqueues; it never enqueues or
  reorders anything itself. This preserves "only one scan or mutation batch
  runs at a time" with zero change: fix batches, ignore/restore/exclude
  dispositions, and manual scans all keep funneling through the same
  `operationQueue` (`main.test.ts` pins this in "serializes complete scan
  flows through snapshot persistence" and "keeps a manual scan queued until
  fix preflight and verification finish").
- **Publish optional progress events** — the session takes optional hooks
  (`onScanningChange`, `onProgress`, `onResult`). Every hook is optional, so a
  headless call passes none and never constructs a view.
- **Compare and accept successful results** — `acceptScanResult` (the module
  function that replaces the private method) computes the
  `LifecycleComparison` against `deps.getSnapshot()`, invokes
  `hooks.onResult` (the manual path's `view.setResult`), builds the next
  snapshot and history entry, and persists through `deps.persistAccepted`
  (the plugin's `persistPluginData`, which owns the save queue, candidate
  payloads, and rollback semantics).
- **Persist snapshot and summary history** — unchanged payloads:
  `createScanSnapshot` + `appendScanHistoryEntry(createScanHistoryEntry(…))`
  move verbatim from `src/main.ts` into the session, fed by `deps.getSnapshot`
  / `deps.getHistory` so the save-queue invariants ("persists each accepted
  candidate instead of reading a later global candidate") are preserved.
- **Return a result without requiring an open `InspectorView`** —
  `runScanSession` returns a discriminated outcome
  (`{ status: "completed"; result; comparison; persistWarning? }` or
  `{ status: "failed"; message }`) and never touches `Notice`, DOM, or view
  objects. Human-facing notices stay in `src/main.ts`.
- **Manual scans still open and update the report view** — `runScan()`,
  `configureView`, view opening/reveal, and outcome clearing in
  `scanAndRender` are untouched; main simply passes view-backed hooks into the
  session (`onScanningChange: view.setScanning`,
  `onProgress: view.setScanProgress`, `onResult: view.setResult`).
- **A failed progress consumer cannot convert a completed scan into a failed
  detection result** — the session wraps each `onProgress` invocation in
  `try { hooks.onProgress?.(progress) } catch { /* isolated */ }`. Today a
  throwing `view.setScanProgress` would reject the scan; after this task it
  cannot. Deliberately NOT isolated: `onScanningChange(true)` at startup (a
  view that cannot enter the scanning state must not start vault reads —
  pinned by "reports one scan notice and recovers the operation queue when
  scan startup throws") and `onResult` (a view that cannot display results is
  an acceptance failure — pinned by "recovers the scan queue after an
  unexpected acceptance error without duplicate notices").

## Non-goals (this PR)

- No new scan trigger — the automatic stale-scan scheduler is Task 3.4; this
  task only makes headless scans possible.
- No change to the serialized boundary itself (`enqueueOperation`,
  `operationQueue`, `saveQueue` in `src/main.ts`) — the session is enqueued
  through it, not a replacement for it.
- No change to `ScanRunner`, scanners, `ScanContext`, fingerprints,
  `COMPARISON_VERSION`, snapshot shape, history shape, or settings.
- No change to `InspectorView` rendering, filters, or lifecycle; no new
  settings; no CLI change.
- No persistence of failed or incomplete scans; no history browsing.

## Design

### Module shape: `src/scanner/scan-session.ts`

```ts
export type ScanDeps = {
	app: App;
	runner: { run(app, settings, options?): Promise<ScanResult> }; // ScanRunner satisfies this
	createProfile: (settings: InspectorSettings) => Promise<string>;
	toolVersion: string;
	getSnapshot: () => ScanSnapshot | null;
	getHistory: () => ScanHistoryEntry[];
	persistAccepted: (accepted: {
		acceptedSnapshot: ScanSnapshot;
		acceptedHistory: ScanHistoryEntry[];
	}) => Promise<void>;
};

export type ScanSessionHooks = {
	onScanningChange?: (scanning: boolean) => void;
	onProgress?: (progress: ScanProgress) => void;
	onResult?: (result: ScanResult, comparison: LifecycleComparison) => void;
};

export type ScanSessionOutcome =
	| { status: "completed"; result: ScanResult; comparison: LifecycleComparison; persistWarning?: string }
	| { status: "failed"; message: string };

export type ScanOperationOutcome =
	| { status: "completed"; result: ScanResult }
	| { status: "failed"; message: string };

export async function runScanSession(deps, settings, hooks?, trigger?): Promise<ScanSessionOutcome>;
export async function runScanOperation(deps, settings, hooks?): Promise<ScanOperationOutcome>;
export async function acceptScanResult(deps, hooks, result, scanProfile, trigger?): Promise<{ comparison; persistWarning? }>;
```

Three exports, one per caller in `src/main.ts`:

1. **`runScanSession`** — the full headless-capable session: clone settings →
   create profile → `runScanOperation` → `acceptScanResult`. Used by
   `performScanAndRender` for manual scans (and by Task 3.4's scheduler with
   no hooks). Profile-creation failures short-circuit BEFORE any scanning
   hook fires (matching today: `createScanProfile` sits outside the scanning
   `try`, pinned by "does not start scanning when the detection profile
   cannot be created").
2. **`runScanOperation`** — the scan-only unit for the verified fix pipeline.
   The fix batch already owns settings freezing and profile creation
   (`onFixAllIssues` clones settings, awaits `createScanProfile`, then runs
   preflight/verification through `scan: (batchSettings) => this.scan(view,
   batchSettings)`), so this operation passes the given settings through
   UNCLONED and performs no acceptance. It replaces the private `scan()`
   body: startup hook, runner call with isolated progress, best-effort
   cleanup on failure.
3. **`acceptScanResult`** — the acceptance step (compare → display hook →
   snapshot + history → persist). Exported because `onFixAllIssues` accepts
   the batch's final verification result under the batch's frozen profile;
   `hooks.onResult` errors propagate (the fix flow publishes outcomes and
   rethrows the original acceptance error), while persistence failures are
   caught and returned as `persistWarning`.

### Scanning-state lifecycle inside the session

Today's call pattern is preserved exactly, hook for hook:

- `onScanningChange(true)` before `runner.run` — failures are startup
  failures.
- `onProgress` per runner event — isolated; a throwing consumer is skipped,
  the scan continues.
- On success the session does NOT call `onScanningChange(false)`: the manual
  path's `view.setResult` already clears the scanning state (verified by
  `main.test.ts` "initializes lifecycle comparison…":
  `model.isScanning` becomes false via `setResult`), and the headless path
  has no state to clear.
- On ANY failure after startup (runner rejection, acceptance error) the
  session calls `onScanningChange(false)` inside its own `try/catch` —
  best-effort cleanup, exactly `stopScanningBestEffort` today ("recovers the
  scan queue after an unexpected acceptance error" pins that cleanup failures
  are swallowed while the original error is reported).
- Profile-creation failure performs no cleanup and no scanning hook — today's
  behavior.

### How `src/main.ts` delegates

- `performScanAndRender(view)` becomes: build `this.scanDeps()` +
  `this.viewHooks(view)`, `await runScanSession(...)`, then translate the
  outcome into the two existing notices (`Vault Inspector scan failed: …` /
  `Scan completed, but the comparison snapshot could not be saved: …`).
  Because the session never throws, `performScanAndRenderHandled` (the
  try/catch wrapper) is deleted and its five call sites call
  `performScanAndRender` directly.
- The private `scan(view, settings)` keeps its signature and becomes a thin
  adapter over `runScanOperation` (notice + `null` on failure) — the fix
  runner's contract is unchanged.
- The private `acceptScanResult` method is deleted; `onFixAllIssues` calls
  the session's `acceptScanResult` and surfaces `persistWarning` with the
  existing notice.
- `scanDeps()` wires the session to plugin state:
  `getSnapshot: () => this.lastSuccessfulSnapshot`,
  `getHistory: () => this.scanHistory`,
  `persistAccepted: (accepted) => this.persistPluginData(accepted)`,
  `createProfile: createScanProfile` (the same import `main.test.ts` mocks),
  `toolVersion: this.manifest.version`. `persistPluginData` keeps ownership
  of the save queue, candidate isolation, and rollback.
- Removed from `main.ts`: `compareScanResult`, `createScanSnapshot`,
  `appendScanHistoryEntry`, `createScanHistoryEntry` imports and
  `stopScanningBestEffort`. Everything view-related (opening, revealing,
  callbacks, outcome clearing, export) stays.

### Mutation-batch interplay

Nothing moves. Fix batches run inside `enqueueOperation`; every scan they
perform (preflight, verification) goes through `runScanOperation` inside the
same enqueued operation, and their acceptance goes through the session's
`acceptScanResult` — still inside the batch's enqueued operation. Manual
`scanAndRender` enqueues the full session. Therefore scans and mutation
batches remain mutually serialized by the ONE `operationQueue`; the session
adds no second lock and cannot deadlock with it.

### Headless contract

`runScanSession(deps, settings)` with no hooks: no view is created, opened,
or referenced; progress events are dropped; acceptance persists snapshot +
history and returns the completed outcome. This is the exact shape Task 3.4's
scheduler will call with `trigger: "automatic"`.

## Documented deviations from the roadmap file list

- `src/report/InspectorView.ts` is NOT modified. The roadmap listed it, but
  the view already exposes exactly the three hook surfaces the session needs
  (`setScanning`, `setScanProgress`, `setResult`) as plain methods, and
  `setResult` already clears scanning state. Decoupling is achieved entirely
  by `src/main.ts` passing optional hooks; no view API change exists to make.
- `src/tests/main.test.ts` is NOT modified. All 65 tests drive the plugin
  through its existing flows (`scanAndRender`, callbacks, `onFixAllIssues`,
  `saveSettings`), which the delegation preserves behavior-for-behavior; the
  private methods they indirectly pin (`performScanAndRender`, `scan`) keep
  their names and signatures. Session-specific guarantees
  (progress-consumer isolation, hook-free completion, clone-before-profile,
  outcome shapes) get a NEW focused suite: `src/tests/scan-session.test.ts`.

## Test strategy

`src/tests/scan-session.test.ts` (new, pure doubles — no Obsidian mocking
needed beyond `App` as `{}`):

- clones settings once and reuses the clone for profile creation and the
  runner (mutating the live settings after the call starts cannot leak in);
- completes fully headless with no hooks: persists snapshot + one history
  entry and returns `{ status: "completed" }` with the comparison computed
  against the pre-scan snapshot;
- propagates `trigger` (e.g. `"automatic"`) into the history entry;
- isolates a throwing `onProgress`: the runner still completes, the outcome is
  `completed`, and persistence still happens (the new guarantee);
- returns `failed` WITHOUT persistence or history when the runner rejects,
  and performs best-effort `onScanningChange(false)` cleanup whose own throw
  is swallowed;
- treats a throwing `onScanningChange(true)` as a startup failure (runner
  never called) and a profile-creation failure as a failure with no hooks
  fired;
- propagates a throwing `onResult` as `failed` without persisting, with
  best-effort cleanup;
- returns `completed` with `persistWarning` when `persistAccepted` rejects
  (result and comparison still delivered; no exception escapes);
- `runScanOperation` passes the given settings through uncloned (fix-path
  freezing stays with the caller) and returns the runner's result.

`src/tests/main.test.ts` runs unchanged as the integration pin: all 65 tests
must pass without edits — that is itself the acceptance evidence that manual
behavior is unchanged.

## Verification strategy

```bash
npm test -- src/tests/scan-session.test.ts src/tests/main.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: manual behavior remains unchanged (main.test.ts green, unedited)
and successful headless scans update persistence through the same acceptance
path (scan-session.test.ts green).

## Precision-suite and CLI impact

None. Scanner behavior, fingerprints, `COMPARISON_VERSION`, snapshot and
history shapes, settings, and `cli/` are untouched. The precision suite
observes scanners only. The session is plugin-internal; no stable CLI field
moves. `scan-session.ts` lives under `src/scanner/` but imports Obsidian only
as a type (`App`), keeping the obsidian-warning lint surface clean.

## Risks

- **Two acceptance call sites.** Manual scans accept inside `runScanSession`;
  fix batches accept via the exported `acceptScanResult`. Both share one
  implementation, and `main.test.ts` pins both flows, so divergence would be
  caught immediately.
- **Outcome-based error handling.** The session returns failures instead of
  throwing; a future caller could forget to surface `message`. Both current
  callers translate outcomes into the exact existing notices, and
  `scan-session.test.ts` pins the outcome shapes.
- **`onScanningChange(false)` is not called on success.** The manual path
  relies on `view.setResult` clearing scanning state (existing behavior). If
  a future headless consumer needs scanning state, it must clear it itself —
  documented here so it is a decision, not an accident.
