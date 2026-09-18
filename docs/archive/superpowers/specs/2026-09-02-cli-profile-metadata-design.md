# CLI Profile Metadata Design (Milestone 4, Task 4.1)

Date: 2026-09-02
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 4, Task 4.1)
Predecessors: `docs/superpowers/specs/2026-08-31-changes-first-summary-design.md` (Task 3.2, merged — `compareScanResult` in `src/scanner/result-diff.ts` and `COMPARISON_VERSION` in `src/snapshot/scan-snapshot.ts` define the plugin-side lifecycle vocabulary this task mirrors), `docs/superpowers/specs/2026-08-31-verified-batch-execution-design.md` (merged — the CLI's stable automation field list this task extends additively)

## Problem

The CLI's JSON output reports lifecycle information in exactly two places: the
per-issue `isNew` annotation and `summary.newIssues`. Both are computed by
`applyOutputFilters` in `cli/cli.ts` from a fingerprint-only baseline set read
by `readBaselineFingerprints`. A consumer cannot tell:

- **whether a comparison happened at all** — `isNew: true` on every issue
  means both "no baseline was passed" and "baseline passed, everything is
  new";
- **what kind of comparison it was** — today's baselines are prior CLI JSON
  reports with no scan profile or comparison-version metadata, so the
  comparison is fingerprint-only ("legacy"), never profile-aware;
- **how many issues persisted or resolved** — only the new count exists;
- **which scan profile and comparison version produced the result** — the
  fields that make a baseline reusable across runs (`scanProfile`,
  `comparisonVersion`) are not emitted at all, which is also the prerequisite
  Task 4.2 needs to make baseline comparison compatibility-aware.

Task 4.1 adds this as additive top-level metadata. It does NOT make the
comparison itself compatibility-aware — that is Task 4.2.

## Goals

The roadmap's required behavior, restated as where each guarantee lives:

- **Additive top-level `CliComparison` metadata** — `cli/cli.ts` gains a
  `CliComparison` type following the roadmap sketch, emitted as one new
  top-level `comparison` object in the JSON payload. The type:

  ```ts
  type CliComparison = {
  	available: boolean;
  	mode: "profile" | "legacy" | "none";
  	reason?: "missing-baseline" | "settings-changed" | "semantics-changed";
  	newIssues: number;
  	persistingIssues: number;
  	resolvedIssues: number;
  };
  ```

  extended with two always-present fields so the payload also satisfies "emit
  scan profile and comparison version": `scanProfile: string` (the
  `createScanProfile` hash of the effective CLI settings) and
  `comparisonVersion: number` (`COMPARISON_VERSION`).

- **Emit scan profile and comparison version without removing stable
  fields** — every existing top-level key stays byte-identical:
  `schemaVersion`, `tool`, `toolVersion`, `vaultPath`, `generatedAt`,
  `summary`, `issues`, `ignoredIssues`. `comparison` is appended after
  `ignoredIssues`. `schemaVersion` stays `1`: the change is additive, and the
  roadmap's own compatibility contract for the CLI is "old fields remain
  present and new profile metadata is additive".
- **Retain `isNew` for compatibility** — `applyOutputFilters` is untouched.
  Per-issue `isNew`, `summary.newIssues`, `--fail-on new`, and all exit-code
  behavior are computed exactly as today. The new counts must agree with
  `isNew` (same fingerprint-set logic, see Interpretation decisions).
- **Machine-readable schema additions, messages informational** — the
  `comparison` object is typed, deterministic JSON: booleans, a closed string
  union for `mode`, a closed optional string union for `reason`, and three
  integer counts. No human prose enters the object; prose stays on stderr
  behind `--progress` where it already lives.
- **JSON on stdout, progress/warnings on stderr** — unchanged. The
  `comparison` object is part of the stdout JSON payload (or the `--output`
  file); nothing new is printed to stderr in 4.1. Errors (unreadable vault,
  unreadable baseline) keep the existing exit-2 path via the outer `catch`.
- **Compute `mode`/`reason`/counts from the existing baseline path** —
  `runCli` reads the baseline exactly as today (`readBaselineFingerprints`
  over `parsed.baselinePath`), then:
  - **no `--baseline`** → `{ available: false, mode: "none", reason:
    "missing-baseline", newIssues: 0, persistingIssues: 0, resolvedIssues: 0 }`
    — an honest "nothing was compared" instead of today's ambiguous
    everything-is-new;
  - **baseline passed** → `{ available: true, mode: "legacy", ... }` with
    counts derived from the fingerprint set. `mode` is `"legacy"` because
    every baseline the CLI can read today is a prior JSON report without
    `scanProfile`/`comparisonVersion` metadata — there is no way in 4.1 to
    verify the baseline was produced under the same detection semantics, so
    claiming `mode: "profile"` would be a lie. `mode: "profile"` becomes
    reachable in Task 4.2, which teaches `readBaselineFingerprints`' successor
    to read profile metadata and downgrade mismatches to setup failures.
- **`settings-changed` / `semantics-changed` are declared but not produced in
  4.1** — they exist in the `reason` union (roadmap sketch) and are the exact
  reasons Task 4.2 emits when a profile-aware baseline mismatches. In 4.1 no
  baseline carries the metadata needed to detect either condition, so the
  union member is part of the published schema but unreachable this PR.

### Interpretation decisions (documented, not accidental)

- **`available` mirrors `LifecycleComparison.available` semantics**: "the
  new/persisting/resolved counts are trustworthy lifecycle claims". With no
  baseline there is nothing to compare against, so `available: false` and all
  counts are `0` — NOT "everything is new", which is what `isNew` implies
  today. The two fields answer different questions: `isNew` keeps its
  historical baseline-annotation meaning (unchanged for compatibility);
  `comparison.available` states whether a comparison happened.
- **Counts are computed over the unfiltered `ScanResult`, not the filtered
  output.** `newIssues`/`persistingIssues` count every fingerprint in
  `result.issues` + `result.ignoredIssues` (active and ignored findings)
  against the baseline set; `resolvedIssues` counts baseline fingerprints
  absent from that same full fingerprint set. `--severity`/`--include`/
  `--exclude` filters shape `issues` for display and exit codes, but filtering
  a severity away must not report those issues as "resolved". This matches
  `compareScanResult` in `src/scanner/result-diff.ts`, which compares the full
  result (issues + ignoredIssues) against the snapshot. Consequence:
  `comparison.newIssues` may exceed `summary.newIssues` when filters or
  ignored findings are in play; `summary.newIssues` is unchanged and remains
  the filtered/compatible count. Documented in the payload order and in tests.
- **`mode: "legacy"` is `available: true`.** A fingerprint-only comparison is
  a real comparison — it is what `isNew` has always meant — it just cannot
  prove semantic compatibility. Task 4.2 keeps `available: true` for legacy
  baselines (with a stderr warning) and turns current-format mismatches into
  exit-2 setup failures.
- **Empty baseline file (zero issues) is a real baseline.** `runCli` passes
  `null` for "no baseline requested" and a (possibly empty) `Set` for
  "baseline read", so an empty baseline yields `mode: "legacy"`,
  `newIssues = <current count>`, `resolvedIssues: 0` — not
  `missing-baseline`.
- **The scan profile is computed from the effective CLI settings** via the
  existing `makeSettings(parsed)` object, using the same
  `createScanProfile(settings)` the plugin uses. `--scanner`,
  `--ignore-folder`, `--config` thresholds, etc. all flow into the hash, so
  the emitted `scanProfile` is the identity of the detection semantics that
  produced this report — exactly what a 4.2 consumer will compare their
  baseline's profile against.

## Non-goals (this PR)

- No compatibility-aware comparison: reading `scanProfile` /
  `comparisonVersion` from baselines, `mode: "profile"`, legacy stderr
  warnings, and exit-2 on current-format profile/semantics mismatch are all
  Task 4.2.
- No snapshot persistence, no resolved-issue rows, no `previousScanAt` — the
  CLI stays stateless; `comparison` describes this one run against the
  optional `--baseline` file only.
- No change to `isNew`, `summary` (including `summary.newIssues`),
  `--fail-on`, exit codes, markdown output, or any stable automation field.
- No change to `src/scanner/scan-profile.ts` or
  `src/snapshot/scan-snapshot.ts` — see deviations below.
- No change to `skills/vault-inspector/SKILL.md` — its stable-field list
  gains the `comparison` object in roadmap Task 4.3 ("Document profile-aware
  baselines and legacy behavior"), which owns all skill/README documentation
  alignment. 4.1 only notes the dependency.
- No new CLI flags; `--baseline` semantics and `--help` text are unchanged.

## Design

### JSON shape (additive)

```json
{
  "schemaVersion": 1,
  "tool": "vault-inspector",
  "toolVersion": "…",
  "vaultPath": "…",
  "generatedAt": "…",
  "summary": { "…": "unchanged" },
  "issues": [ "…unchanged, isNew retained" ],
  "ignoredIssues": [ "…unchanged" ],
  "comparison": {
    "available": false,
    "mode": "none",
    "reason": "missing-baseline",
    "newIssues": 0,
    "persistingIssues": 0,
    "resolvedIssues": 0,
    "scanProfile": "sha256-of-effective-detection-settings",
    "comparisonVersion": 2
  }
}
```

With `--baseline <prior-report>` (legacy, fingerprint-only):

```json
"comparison": {
  "available": true,
  "mode": "legacy",
  "newIssues": 1,
  "persistingIssues": 2,
  "resolvedIssues": 3,
  "scanProfile": "…",
  "comparisonVersion": 2
}
```

`reason` is present only when `available` is `false`.

### Where `CliComparison` is computed

All in `cli/cli.ts` (the roadmap's file list is CLI-side; nothing under
`src/` needs new logic):

1. `runCli` hoists `makeSettings(parsed)` into a `scanSettings` const, then
   computes `scanProfile = await createScanProfile(scanSettings)` before the
   scan and passes `scanSettings` to `scanRunner.run`. `createScanProfile` is
   pure and fast (one canonical JSON + one hash); computing it before the scan
   keeps the profile tied to the request, not the result.
2. The baseline read changes shape, not behavior:
   `parsed.baselinePath ? await readBaselineFingerprints(...) : null` — `null`
   means "no baseline requested". `applyOutputFilters` receives
   `baselineFingerprints ?? new Set<string>()`, preserving today's
   `isNew`-all-true behavior bit-for-bit.
3. New pure function `buildCliComparison(result, baseline, scanProfile)`:

   ```ts
   function buildCliComparison(
   	result: ScanResult,
   	baseline: Set<string> | null,
   	scanProfile: string,
   ): CliComparison;
   ```

   No-baseline → the `none`/`missing-baseline` zero object. Baseline →
   `mode: "legacy"`, counts from the full fingerprint set of
   `result.issues` + `result.ignoredIssues` (see Interpretation decisions).
   Both branches always carry `scanProfile` and `comparisonVersion`
   (`COMPARISON_VERSION` imported from `src/snapshot/scan-snapshot.ts`).
4. `formatResult` and `toJsonPayload` gain a `comparison` parameter; the
   JSON branch adds the object after `ignoredIssues`. The markdown branch
   ignores it — `generateMarkdownReport` is untouched, keeping the markdown
   format and its tests stable.

`CliComparison` is exported from `cli/cli.ts` for Task 4.2 and for future
`src/tests/cli.test.ts` typing convenience; it is not re-exported through any
`src/` module.

## Documented deviations from the roadmap file list

- `src/scanner/scan-profile.ts` is listed but needs NO change:
  `createScanProfile(settings)` is already exported and already hashes the
  effective detection settings; the CLI simply imports it. (Verified against
  the merged file — export at line 16.)
- `src/snapshot/scan-snapshot.ts` is listed but needs NO change:
  `COMPARISON_VERSION` is already exported (line 18, currently `2`). Emitting
  it in the CLI payload requires an import only.
- `src/tests/cli-package.test.ts` is listed but needs NO change: it pins the
  npm packaging contract (`pkg.bin`, `files`, esbuild entry points) — nothing
  in this task touches packaging; `cli.js` bundling is unchanged. The
  roadmap's `node cli.js --help` verification is covered as a manual step in
  the plan's verification task.
- `src/tests/cli.test.ts` IS modified, including one pre-existing assertion
  that flips meaningfully: the test "prints machine-readable JSON scan
  results" currently asserts `expect(payload).not.toHaveProperty("comparison")`
  and `expect(payload).not.toHaveProperty("resolvedIssues")`. The first
  assertion was the pre-4.1 pin that no comparison data leaked; this task is
  precisely the sanctioned introduction of that key, so the assertion becomes
  an exact-shape check of the `none`/`missing-baseline` object. The
  top-level `not.toHaveProperty("resolvedIssues")` assertion stays (resolved
  counts live nested under `comparison`, never top-level).

## Test strategy

`src/tests/cli.test.ts` (extend, no new file):

- **Rewrite the comparison assertions** in "prints machine-readable JSON scan
  results": without `--baseline`, `payload.comparison` equals exactly
  `{ available: false, mode: "none", reason: "missing-baseline", newIssues:
  0, persistingIssues: 0, resolvedIssues: 0, scanProfile: expect.any(String),
  comparisonVersion: 2 }`; top-level keys `schemaVersion`/`toolVersion`/
  `summary`/`issues`/`ignoredIssues` all still present; no top-level
  `resolvedIssues`.
- **Extend "marks baseline issues and fails only on new issues"**: with a
  baseline whose single issue persists, `comparison` is
  `{ available: true, mode: "legacy", newIssues: 0, persistingIssues: 1,
  resolvedIssues: 0, scanProfile: expect.any(String), comparisonVersion: 2 }`
  and `payload.issues[0].isNew` stays `false` — pinning that `isNew` and the
  counts agree.
- **New test "reports legacy comparison counts including resolved issues"**:
  first scan over two empty notes → baseline; delete one note; second scan
  with `--baseline`: `newIssues: 0`, `persistingIssues: 1`, `resolvedIssues:
  1`, exit code `0` under `--fail-on new`.
- **New test pinning stdout/stderr discipline**: the `comparison` object is
  parseable from `stdout` only; `stderr` stays empty without `--progress`
  (covered by asserting `result.stderr).toBe("")` inside the count tests).

## Verification strategy

```bash
npm test -- src/tests/cli.test.ts src/tests/cli-package.test.ts
npm run build && node cli.js --help
npm run lint && npm run lint:obsidian-warnings && npm test
```

Expected: old fields remain present and the new profile metadata is additive;
`--help` output unchanged; full gates green.

## Precision-suite and CLI impact

- **Precision suite: none.** Scanners, `ScanRunner`, fingerprints, snapshot
  shape, `result-diff.ts`, and the plugin are untouched.
  `src/tests/scan-profile.test.ts` passes unedited — `createScanProfile` is
  only imported by the CLI, not modified.
- **CLI compatibility: additive only.** Every stable automation field
  (`schemaVersion`, `toolVersion`, `summary`, issue `fingerprint`,
  `scannerId`, `severity`, `classification`, `explanation`, `primaryPath`,
  `relatedPaths`, `evidence`, `fixAction`, `isNew`, `summary.newIssues`)
  is emitted unchanged. New consumers may read `comparison`; old consumers
  ignore it. `--fail-on new` semantics, exit codes, markdown output, and
  stdout/stderr discipline are bit-compatible.
- **Task 4.2 hand-off**: 4.2 replaces the `readBaselineFingerprints` +
  `mode: "legacy"` default with metadata-aware reading (producing
  `mode: "profile"`, `reason: "settings-changed"` / `"semantics-changed"`,
  and exit-2 on current-format mismatch), reusing the `CliComparison` type
  and `buildCliComparison`'s counting logic unchanged. Task 4.3 then
  documents `comparison` in `skills/vault-inspector/SKILL.md`'s stable-field
  list and README.

## Risks

- **`comparison.newIssues` vs `summary.newIssues` divergence** when filters or
  ignored findings are in play (comparison counts the full result; summary
  counts filtered active issues). Deliberate and mirrored from
  `compareScanResult`; mitigated by the design note above and by tests
  pinning each count separately. Task 4.3 documents the distinction for
  agents.
- **Consumers that treated `isNew: true` as "no baseline"** now have a
  strictly better signal; nothing regresses because `isNew` semantics are
  frozen. The old ambiguity is the reason `comparison` exists.
- **`mode` is `"legacy"` for every baseline in 4.1** — a 4.1 consumer cannot
  yet distinguish a trustworthy profile-matched baseline. That is the honest
  state of the world until 4.2; the schema reserves `"profile"` so no
  breaking change is needed when it arrives.
