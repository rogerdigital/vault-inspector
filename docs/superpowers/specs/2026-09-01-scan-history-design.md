# Scan History Design (Milestone 3, Task 3.1)

Date: 2026-09-01
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 3, Task 3.1)
Predecessors: `docs/superpowers/specs/2026-08-31-verified-batch-execution-design.md` (Task 2.3, merged — `runFixBatch` freezes settings and its final verification scan flows through the same `acceptScanResult` path in `src/main.ts`)

## Problem

Vault Inspector persists exactly one complete last-successful snapshot
(`lastSuccessfulSnapshot` in the settings-plus-snapshot envelope,
`src/settings/plugin-data.ts`). Every accepted scan replaces it, so all
knowledge of how the vault's maintenance state evolved — how many findings
were new last week, whether errors are trending up, when the previous
successful scan ran — is destroyed at each acceptance. Task 3.2 will make
changes the primary report summary, but a summary of change needs a record of
past scans to summarize against, and Task 3.4's stale-scan trigger needs the
last successful scan time. Storing multiple complete snapshots to get there
would grow `data.json` without bound (each snapshot carries the full issue
list with evidence and explanations).

The roadmap's requirement: keep the existing complete last-successful
snapshot, plus at most twenty compact history entries recording only
per-scan summary numbers, so trend information survives without any second
issue list.

## Goals

The roadmap's required behavior, restated as where each guarantee lives:

- **Compact entries with the roadmap's exact fields** — a new pure module
  `src/snapshot/scan-history.ts` owns the `ScanHistoryEntry` type, entry
  creation, validation, appending, and bound enforcement. Each entry stores:
  creation time and tool version; scan profile and comparison version; manual
  or automatic trigger; files scanned and scanners run; active / ignored /
  new / persisting / resolved totals; severity and classification counts.
- **No multiple complete issue lists** — an entry contains only scalars, the
  `scannersRun` id list, and count records. It carries no fingerprints, no
  evidence, no issue objects. The single `lastSuccessfulSnapshot` remains the
  only stored issue list.
- **Keep the newest twenty valid entries** — `appendScanHistoryEntry`
  prepends (history is newest-first) and truncates to
  `MAX_HISTORY_ENTRIES = 20`; `parseScanHistory` filters invalid entries
  individually and then truncates to twenty, so the newest valid entries
  survive on load.
- **Parse legacy flat settings AND the current envelope** —
  `parsePluginData` gains a `scanHistory` output (empty for legacy flat data
  and non-record data; parsed from the envelope's optional `scanHistory`
  array otherwise). Legacy users lose nothing; they simply start with an
  empty history.
- **Discard invalid history entries without discarding valid settings or the
  last successful snapshot** — history parsing is independent of the
  settings and snapshot branches: `parseScanHistory` never throws, and an
  invalid `scanHistory` value (non-array, or an array of garbage) collapses
  to `[]` while `value.settings` and `value.lastSuccessfulSnapshot` are
  evaluated exactly as today. Per-entry validation
  (`isScanHistoryEntry`) discards only the invalid entries, mirroring how
  `isScanSnapshot` guards the snapshot.
- **Failed or incomplete scans do not append history or replace snapshots** —
  the append happens inside `acceptScanResult` (`src/main.ts`), the single
  acceptance path both scan flows already share. A scan that throws or
  returns `null` never reaches acceptance. A persistence failure rolls both
  back together: `persistPluginData` commits `lastSuccessfulSnapshot` and
  `scanHistory` in memory only after `saveData` resolves, so a failed write
  leaves both untouched (the existing snapshot-rollback semantics, extended
  to history).

## Non-goals (this PR)

- No history UI, browsing, charts, or export — the roadmap explicitly
  excludes "full scan-history browsing, arbitrary snapshot selection, charts,
  or analytics". Task 3.2 reads history only as "previous successful scan
  time" from the entry list.
- No automatic scans — `trigger: "automatic"` exists in the type and
  validation now (the field list requires it), but every producer in this PR
  passes `"manual"`; Task 3.4 introduces the automatic trigger.
- No change to `ScanResult`, `compareScanResult`, fingerprints,
  `COMPARISON_VERSION`, `SNAPSHOT_SCHEMA_VERSION`, or the snapshot shape —
  history summarizes what those already compute; it does not alter them.
- No CLI change — the CLI has no plugin persistence (`data.json` is an
  Obsidian plugin concept); the npm package's JSON output is untouched.
- No settings additions — history is not user-configurable (the bound of
  twenty is fixed by the roadmap), so no settings type/default/tab work is
  needed.

## Design

### Entry shape

```ts
export const HISTORY_SCHEMA_VERSION = 1;
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
```

Field sources, all computed in `createScanHistoryEntry`:

- `createdAt`, `toolVersion`, `scanProfile` — the same inputs
  `createScanSnapshot` receives (`this.manifest.version`, the awaited
  profile), so an entry and the snapshot accepted alongside it describe the
  same scan.
- `comparisonVersion` — the current `COMPARISON_VERSION` (2) from
  `src/snapshot/scan-snapshot.ts`. An entry always records the semantics the
  scan ran under, even though the count semantics themselves are
  version-independent numbers.
- `trigger` — passed by the acceptance path; `"manual"` is the default for
  every existing caller, and Task 3.4 passes `"automatic"`.
- `filesScanned`, `scannersRun` — copied from `ScanResult` (`scannersRun`
  cloned to a fresh array).
- `totals.active` / `totals.ignored` — `result.issues.length` /
  `result.ignoredIssues.length`.
- `totals.newIssues` / `totals.persistingIssues` / `totals.resolvedIssues` —
  counted from the `LifecycleComparison` that `acceptScanResult` already
  computes via `compareScanResult` (`src/scanner/result-diff.ts`): new and
  persisting are the counts of `"new"` / `"persisting"` values in
  `comparison.statuses` (which covers active AND ignored findings — the
  roadmap keeps ignored findings active in lifecycle comparison), resolved is
  `comparison.resolvedIssues.length`. When comparison is unavailable
  (`available: false` — first scan, settings changed, or semantics changed),
  all three are `0`: an entry still records the scan happened and what its
  totals were, without claiming lifecycle facts it cannot know.
- `severityCounts` / `classificationCounts` — counted over ACTIVE issues
  only; ignored findings are already represented by `totals.ignored` (and in
  the new/persisting counts), so double-counting them by severity would make
  `severityCounts` sum inconsistent with `totals.active`.

### Validation and discard rules

`isScanHistoryEntry` mirrors the snapshot module's defensive style (strict
`hasOnlyKeys` at every level, plain-record prototype checks, safe-integer
count checks) because persisted data is untrusted input:

- `schemaVersion` must equal `HISTORY_SCHEMA_VERSION`; `comparisonVersion`
  must be a positive safe integer (a future comparison version's entries stay
  readable — counts are plain numbers — exactly like snapshots from another
  comparison version survive `isScanSnapshot`).
- `createdAt` finite number; `toolVersion` / `scanProfile` strings;
  `trigger` one of `"manual" | "automatic"`.
- `filesScanned` and every count a non-negative safe integer.
- `scannersRun` a non-empty array of known `ScannerId`s with no duplicates.
- `totals`, `severityCounts`, `classificationCounts` records with exactly
  their documented keys.
- Unknown fields anywhere → invalid (forward-compat discipline: future
  fields require a schema bump, not silent re-persistence of unvalidated
  data — same rationale as the snapshot tests that reject `responseBody`).

`parseScanHistory(value)` returns `[]` for non-arrays, otherwise
`value.filter(isScanHistoryEntry).slice(0, MAX_HISTORY_ENTRIES)` — the
newest twenty VALID entries, in stored (newest-first) order. Truncation
after filtering means an invalid entry injected mid-list never pushes a
valid old entry out of bounds.

### Envelope format evolution

`PersistedPluginData` gains one optional key:

```ts
export type PersistedPluginData = {
	settings: InspectorSettings;
	lastSuccessfulSnapshot?: ScanSnapshot;
	scanHistory?: ScanHistoryEntry[];
};
```

and `ParsedPluginData` gains `scanHistory: ScanHistoryEntry[]` (never
optional — callers get `[]`, not `undefined`, for legacy data). Persistence
omits the key when the history is empty, mirroring the existing
`lastSuccessfulSnapshot` key omission, so a fresh install's `data.json`
shape is unchanged.

### Where the append happens: the acceptance path

`acceptScanResult` in `src/main.ts` (lines 360–385 today) is the only place
a scan becomes durable, shared by manual scans (`performScanAndRender`) and
the fix batch's final verification (`onFixAllIssues`). It becomes:

1. compute the comparison (unchanged, already there);
2. render the result (unchanged);
3. build `nextSnapshot` (unchanged) AND `nextHistory =
   appendScanHistoryEntry(this.scanHistory, createScanHistoryEntry({ ... }))`;
4. persist both in ONE `persistPluginData({ acceptedSnapshot: nextSnapshot,
   acceptedHistory: nextHistory })` call.

`persistPluginData` serializes through the existing `saveQueue`, writes both
values in one `saveData` payload, and commits `this.lastSuccessfulSnapshot`
/ `this.scanHistory` in memory only after the write resolves — so a failed
save rolls history back with the snapshot (one Notice, existing behavior),
and a settings-only save (`saveSettings`) re-persists the current history
unchanged alongside the snapshot, as it already does for the snapshot.

The failed/incomplete guarantee needs no new code: `performScanAndRender`
returns before acceptance when `scan()` throws or returns `null`, and the
fix batch skips acceptance entirely when there is no verification result —
both behaviors pinned by existing `main.test.ts` tests ("leaves the accepted
baseline untouched when scanning fails", "does not accept a null
verification result").

### Legacy parsing

`parsePluginData` already branches on `isRecord(value.settings)`. The legacy
flat-settings branch and the non-record fallback simply return
`scanHistory: []`. The envelope branch parses `value.scanHistory` through
`parseScanHistory`. An invalid history therefore never invalidates the
envelope itself — the discard guarantee is structural, not a recovery path.

### Documented deviations from the roadmap file list

- `src/snapshot/scan-snapshot.ts` and `src/tests/scan-snapshot.test.ts` are
  NOT modified. The roadmap anticipated reuse of snapshot diff summaries
  there, but `compareScanResult` (`src/scanner/result-diff.ts`) already
  computes the new/persisting/resolved data the entries need, and
  `createScanSnapshot` / `isScanSnapshot` are untouched; the summary logic's
  natural home is the new `scan-history.ts` module.
- `src/tests/main.test.ts` IS modified (one exact-equality assertion gains
  the persisted `scanHistory` key, plus one new acceptance test). The
  roadmap's file list omitted it, but `main.ts` persistence changes cannot
  land with a failing pinned assertion.

## Test strategy

- `src/tests/scan-history.test.ts` (new) pins:
  - entry creation from a result + available comparison (exact entry
    object, newest lifecycle semantics, counts over active issues only,
    ignored counted in `totals.ignored` but in new/persisting when present
    in `statuses`);
  - creation with an unavailable comparison records zero lifecycle totals;
  - entry creation clones `scannersRun`;
  - append is newest-first, and appending to a full history drops the
    oldest (21 → 20);
  - `isScanHistoryEntry` accepts a created entry and rejects: wrong
    schema version, non-positive/non-integer comparison version, unknown
    trigger, negative or non-integer counts, empty / unknown-id /
    duplicated `scannersRun`, unknown fields at every level, extra or
    missing count keys;
  - `parseScanHistory` returns `[]` for non-arrays, keeps valid entries
    while discarding invalid ones individually, and keeps only the newest
    twenty valid entries.
- `src/tests/plugin-data.test.ts` (extended; every existing expectation
  gains `scanHistory: []`) pins:
  - envelope parsing returns the parsed history;
  - invalid entries are discarded without affecting settings or the
    snapshot;
  - legacy flat settings and non-record data parse with an empty history.
- `src/tests/main.test.ts` (deviation) pins:
  - an accepted scan appends exactly one entry to `plugin.scanHistory` and
    persists it in the same envelope write as the snapshot;
  - a failed scan run leaves the history untouched (extends the existing
    baseline-untouched test's subject).

## Verification strategy

```bash
npm test -- src/tests/scan-history.test.ts src/tests/plugin-data.test.ts src/tests/scan-snapshot.test.ts src/tests/main.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: persistence is backward compatible (legacy and envelope fixtures
parse), bounded (twenty-entry cap proven), and updated only after accepted
successful scans (acceptance-path and rollback tests).

## Precision-suite and CLI impact

None. The precision fixture suite observes scanner behavior, which is
untouched. The CLI never reads or writes `data.json`; `cli/` is unmodified
and no stable CLI field moves. `compareScanResult`, fingerprints, and
`COMPARISON_VERSION` are unchanged, so diff behavior is bit-identical.

## Risks

- **`data.json` grows by at most twenty compact entries.** Each entry is a
  few hundred bytes of scalars — bounded by construction, versus one full
  snapshot per scan, which is exactly what the design avoids.
- **Small helper duplication.** `scan-history.ts` re-implements the
  `isPlainRecord` / `hasOnlyKeys` / `isOneOf` guards privately rather than
  exporting them from `scan-snapshot.ts`. Exporting shared validators would
  widen the snapshot module's surface for two five-line functions; the
  duplication is deliberate and local. If a third consumer appears, extract
  then.
- **Ordering is a convention, not a validated invariant.** Entries are
  newest-first by construction (`appendScanHistoryEntry` prepends) and
  truncation assumes that order, but validation does not check `createdAt`
  monotonicity — a hand-edited file could store out-of-order entries. The
  consumer contract (Task 3.2 reads the newest scan time) tolerates this:
  it reads `history[0]`, which is whatever the plugin last prepended. Adding
  a monotonicity requirement would discard entries after a legitimate clock
  adjustment.
- **History rollback on save failure means a retried scan appends twice?**
  No — on save failure the in-memory history is unchanged, so the retry
  appends to the unchanged list; only one entry per accepted-and-saved scan
  ever survives. The parametrized save-failure matrix in `main.test.ts`
  already pins this durable-baseline pattern for snapshots; history rides
  the same mechanism.
