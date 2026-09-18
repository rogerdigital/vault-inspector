# CLI Baseline Comparison Design (Milestone 4, Task 4.2)

Date: 2026-09-02
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 4, Task 4.2)
Predecessors: `docs/superpowers/specs/2026-09-02-cli-profile-metadata-design.md` (Task 4.1, merged — defines the `CliComparison` type, `buildCliComparison`, the emitted `comparison` payload, and reserves `mode: "profile"` plus the `settings-changed`/`semantics-changed` reasons for this task), `docs/superpowers/specs/2026-08-31-changes-first-summary-design.md` (merged — `compareScanResult` in `src/scanner/result-diff.ts` defines the plugin-side compatibility gate this task mirrors)

## Problem

Since Task 4.1 the CLI emits `comparison` metadata, but the comparison itself is
still blind: `readBaselineFingerprints` reads only `issues[].fingerprint` and
`buildCliComparison` stamps `mode: "legacy"` on every baseline. Consequences:

- **Every 4.1-or-later baseline is mislabeled.** A baseline written by the
  current CLI already carries `comparison.scanProfile` and
  `comparison.comparisonVersion` — exactly the metadata needed to prove
  compatibility — yet the second run still reports `mode: "legacy"`.
- **Incompatible baselines produce false lifecycle claims.** If the second run
  uses different detection settings (`--scanner`, thresholds, ignore rules) or
  a different `comparisonVersion`, fingerprints legitimately change identity.
  Today that surfaces as "everything is new" — and under `--fail-on new` as a
  red CI run that is actually a setup mistake, not a vault regression.
- **True legacy baselines are indistinguishable and silent.** A pre-4.1 report
  (no `comparison` object) is compared fingerprint-only with no warning, so the
  operator never learns the comparison cannot prove semantic compatibility.

## Goals

The roadmap's required behavior, restated as where each guarantee lives:

- **Read current baselines with profile and comparison metadata.**
  `readBaselineFingerprints` is replaced by a `readBaseline` function that
  returns a discriminated union:

  ```ts
  type BaselineReport =
  	| {
  			kind: "current";
  			fingerprints: Set<string>;
  			scanProfile: string;
  			comparisonVersion: number;
  		}
  	| { kind: "legacy"; fingerprints: Set<string> };
  ```

  Detection is by the baseline file's own shape, not by tool version:

  - `comparison` key **absent** → `kind: "legacy"` (pre-4.1 report).
    Fingerprints come from `issues` only — byte-identical to
    `readBaselineFingerprints`, freezing legacy behavior.
  - `comparison` present and a plain object with a non-empty string
    `scanProfile` and a safe positive integer `comparisonVersion` →
    `kind: "current"`. Fingerprints come from `issues` **and**
    `ignoredIssues`, mirroring `createScanSnapshot` in
    `src/snapshot/scan-snapshot.ts`, which records both active and ignored
    findings — without this, a finding that moved between active and ignored
    between runs would falsely count as resolved.
  - `comparison` present but malformed (wrong types, empty profile, non-integer
    version) → thrown `Error("Invalid baseline: comparison metadata is
    malformed")`, which rides the existing outer `catch` in `runCli` to the
    existing setup-failure exit path: exit code `2`, empty stdout, `Scan
    failed: …` on stderr. A file that claims the current format but does not
    carry usable metadata is a broken input, not a legacy baseline and not a
    comparable one.

- **Read legacy baselines through fingerprint-only comparison, expose
  `mode: "legacy"` plus a stderr warning.** For `kind: "legacy"` the behavior
  is exactly Task 4.1's: `available: true`, `mode: "legacy"`, counts and
  `isNew` from the fingerprint set. New: one warning line is always written to
  stderr (not gated by `--progress`, because it is actionable, like error
  messages):

  ```
  Baseline <path> has no scan profile metadata; comparing fingerprints only (legacy mode). Regenerate the baseline to enable profile-aware comparison.
  ```

- **Treat current-format profile or semantics mismatches as setup failures
  with exit code `2`.** When the baseline is `kind: "current"` but
  incompatible, the run does NOT pretend to a comparison:

  - `comparison` in the JSON payload becomes
    `{ available: false, mode: "profile", reason: <mismatch>, newIssues: 0,
    persistingIssues: 0, resolvedIssues: 0, scanProfile, comparisonVersion }`.
    `mode` describes the baseline's *format*; `available` + `reason` describe
    whether lifecycle claims are trustworthy. This makes the mismatch
    machine-readable, which is why the reasons were reserved in 4.1's schema.
  - `isNew` is **omitted** from every issue. This is the "instead of marking
    every issue new" requirement: no per-issue lifecycle annotation is
    fabricated from an incompatible baseline. (`summary.newIssues` still
    counts `isNew !== false`, so it equals the active issue count under a
    mismatch; it is meaningless there and the exit code says so. The field is
    not removed because it is stable automation output.)
  - **Exit code is forced to `2`, overriding `--fail-on` — including
    `none`.** The mismatch is detected after the scan runs (the payload needs
    `summary`/`issues` to be a valid report) but before `getExitCode`;
    `runCli` computes `mismatch ? 2 : getExitCode(result, parsed.failOn)`. A
    setup failure outranks result-based exit codes: `--fail-on new` can
    neither pass (`0`) on a poisoned comparison nor mask (`none`) the setup
    error.
  - A one-line stderr message always accompanies it:

    ```
    Baseline is not comparable (reason: settings-changed). Regenerate the baseline or rerun without --baseline.
    ```

    (with `semantics-changed` substituted accordingly; the machine-readable
    reason lives in the JSON, the prose on stderr).

- **Emit new/persisting/resolved counts for compatible baselines.** A
  `kind: "current"` baseline whose `comparisonVersion` equals
  `COMPARISON_VERSION` and whose `scanProfile` equals the current run's
  profile produces `{ available: true, mode: "profile", … }` with counts from
  the existing `buildCliComparison` fingerprint-set logic, unchanged.
  `isNew` is computed against the baseline fingerprint set as today.

- **Preserve `--fail-on new`, severity thresholds, and existing exit-code
  behavior for comparable scans.** `getExitCode` is untouched. For comparable
  baselines (legacy or matched current) and for no-baseline runs, exit codes,
  severity thresholds, `--fail-on new`, markdown output, and every stable
  automation field behave exactly as in 4.1.

### Mismatch reason mapping

The reason precedence mirrors `compareScanResult` in
`src/scanner/result-diff.ts` (version checked before profile):

| Condition | `comparison.reason` | Exit code |
| --- | --- | --- |
| No `--baseline` | `missing-baseline` (unchanged from 4.1) | normal |
| Legacy baseline | *(none — `available: true`, `mode: "legacy"`)* + stderr warning | normal |
| `comparisonVersion !== COMPARISON_VERSION` | `semantics-changed` | `2` |
| `scanProfile !== current profile` | `settings-changed` | `2` |
| Both differ | `semantics-changed` (precedence) | `2` |
| Malformed `comparison` metadata | *(thrown → `Scan failed: Invalid baseline: …`)* | `2` |

To keep the gate in one place, `src/scanner/result-diff.ts` gains an exported
pure helper that both the plugin and the CLI use:

```ts
export type BaselineMismatchReason = "settings-changed" | "semantics-changed";

export function resolveBaselineCompatibility(
	baselineComparisonVersion: number,
	baselineScanProfile: string,
	currentProfile: string,
): BaselineMismatchReason | null;
```

`compareScanResult`'s two inline `if` guards (lines 30–35) are refactored to
call it — semantics identical, which the untouched
`src/tests/result-diff.test.ts` suite pins.

### Interpretation decisions (documented, not accidental)

- **The scan still runs under a mismatch.** The report must remain a valid
  scan result (issues, summary) so consumers can still see the vault state;
  only the lifecycle claims are withheld and the exit code flags the setup
  problem. Failing before the scan would produce no stdout at all and give
  consumers less information than the pre-4.2 behavior.
- **Legacy fingerprint extraction is frozen to `issues`.** Extending legacy
  reading to `ignoredIssues` would change `isNew` behavior for pre-4.1
  baselines, violating "preserve existing exit-code behavior for comparable
  scans". Only current-format baselines — whose semantics this task defines —
  include ignored fingerprints.
- **The `mode: "profile"` + `available: false` combination is legal.** 4.1's
  doc comment says `reason` is present only when `available` is `false`; it
  never tied `mode: "profile"` to `available: true`. `mode` answers "what
  format was the baseline", `available` answers "are the counts trustworthy".
- **`isNew` omission is not a stable-field removal.** `isNew` is optional in
  `CliIssue` and is only ever *added* by annotation; omitting it under a
  mismatch is a new, previously unreachable state, and consumers keyed on exit
  code `2` will not treat the payload as a scan verdict anyway.
- **Empty-baseline and zero-issue baselines stay real baselines** (4.1
  decision, unchanged): an empty current-format baseline compares as
  `mode: "profile"` with `newIssues = <current count>`.

## Non-goals (this PR)

- No new CLI flags; `--baseline` semantics and `--help` text are unchanged.
- No snapshot persistence, no `previousScanAt` in the CLI payload — the CLI
  stays stateless and compares against the `--baseline` file only.
- No change to stable output keys, `summary` computation, markdown output, or
  stdout-JSON/stderr-discipline (the two new warning lines are stderr, like
  all CLI prose).
- No change to plugin behavior beyond the `compareScanResult` refactor onto
  the shared helper (semantics identical).
- No skill/README documentation changes — roadmap Task 4.3 owns
  `skills/vault-inspector/SKILL.md` and README alignment for profile-aware
  baselines.
- No fail-fast baseline validation before the scan (malformed metadata throws
  after the scan completes; acceptable for a rare broken-input case and it
  keeps the diff minimal).

## Design

### `readBaseline` (replaces `readBaselineFingerprints` in `cli/cli.ts`)

```ts
export type BaselineReport =
	| {
			kind: "current";
			fingerprints: Set<string>;
			scanProfile: string;
			comparisonVersion: number;
		}
	| { kind: "legacy"; fingerprints: Set<string> };

async function readBaseline(path: string): Promise<BaselineReport> {
	const raw = await readFile(path, "utf8");
	const parsed = JSON.parse(raw) as {
		issues?: Array<{ fingerprint?: unknown }>;
		ignoredIssues?: Array<{ fingerprint?: unknown }>;
		comparison?: unknown;
	};

	const readFingerprints = (issues: Array<{ fingerprint?: unknown }> | undefined) =>
		(issues ?? [])
			.map((issue) => issue.fingerprint)
			.filter((fingerprint): fingerprint is string => typeof fingerprint === "string");

	if (parsed.comparison === undefined) {
		return { kind: "legacy", fingerprints: new Set(readFingerprints(parsed.issues)) };
	}

	if (!isBaselineComparisonMetadata(parsed.comparison)) {
		throw new Error("Invalid baseline: comparison metadata is malformed");
	}

	return {
		kind: "current",
		fingerprints: new Set([
			...readFingerprints(parsed.issues),
			...readFingerprints(parsed.ignoredIssues),
		]),
		scanProfile: parsed.comparison.scanProfile,
		comparisonVersion: parsed.comparison.comparisonVersion,
	};
}

function isBaselineComparisonMetadata(
	value: unknown,
): value is { scanProfile: string; comparisonVersion: number } {
	if (typeof value !== "object" || value === null) return false;
	const record = value as { scanProfile?: unknown; comparisonVersion?: unknown };
	return (
		typeof record.scanProfile === "string" &&
		record.scanProfile !== "" &&
		typeof record.comparisonVersion === "number" &&
		Number.isSafeInteger(record.comparisonVersion) &&
		record.comparisonVersion > 0
	);
}
```

### `runCli` flow (replaces the 4.1 baseline block)

```ts
const baseline = parsed.baselinePath ? await readBaseline(parsed.baselinePath) : null;
const mismatch = baseline?.kind === "current"
	? resolveBaselineCompatibility(baseline.comparisonVersion, baseline.scanProfile, scanProfile)
	: null;
if (baseline?.kind === "legacy") {
	writeStderr(
		`Baseline ${parsed.baselinePath} has no scan profile metadata; comparing fingerprints only (legacy mode). Regenerate the baseline to enable profile-aware comparison.\n`,
	);
}
if (mismatch) {
	writeStderr(
		`Baseline is not comparable (reason: ${mismatch}). Regenerate the baseline or rerun without --baseline.\n`,
	);
}
const comparison = buildCliComparison(scanResult, baseline, scanProfile, mismatch);
const result = applyOutputFilters(
	scanResult,
	parsed,
	mismatch ? null : baseline ? baseline.fingerprints : new Set<string>(),
);
const output = formatResult(result, vaultPath, parsed.format, comparison);
const exitCode = mismatch ? 2 : getExitCode(result, parsed.failOn);
```

### `buildCliComparison` (signature extended, counting logic unchanged)

```ts
function buildCliComparison(
	result: ScanResult,
	baseline: BaselineReport | null,
	scanProfile: string,
	mismatch: BaselineMismatchReason | null,
): CliComparison;
```

Branch order: `baseline === null` → 4.1's `none`/`missing-baseline` object;
`mismatch !== null` → `{ available: false, mode: "profile", reason: mismatch,
zero counts, … }`; `kind: "legacy"` → 4.1's legacy object; else
`available: true, mode: "profile"` with the existing fingerprint-set counts.

### `applyOutputFilters` (annotation only)

The `baselineFingerprints` parameter widens to `Set<string> | null`; `null`
means "comparison impossible — do not annotate". `annotate` becomes:

```ts
const annotate = (issue: ScanResult["issues"][number]): CliIssue =>
	baselineFingerprints === null
		? issue
		: {
				...issue,
				isNew: baselineFingerprints.size === 0
					? true
					: !baselineFingerprints.has(issue.fingerprint),
			};
```

No-baseline runs still receive an empty set (`isNew: true` everywhere),
bit-identical to 4.1; only the previously-unreachable mismatch state sees
`null`.

## Documented deviations from the roadmap file list

- `src/scanner/result-diff.ts` IS modified, but only additively plus a
  semantics-preserving refactor: it gains the exported
  `resolveBaselineCompatibility` helper and `compareScanResult` calls it in
  place of its two inline guards. All plugin behavior and every existing
  `result-diff` test outcome are unchanged.
- `src/scanner/scan-profile.ts` is NOT in the 4.2 file list and is not
  touched; the CLI keeps importing `createScanProfile`.
- `src/snapshot/scan-snapshot.ts` is not touched; `COMPARISON_VERSION` is
  imported as in 4.1.
- `src/tests/cli.test.ts` includes two pre-existing assertions that flip
  meaningfully — both Task 4.1 tests wrote baselines with the current CLI,
  so those baselines now carry metadata and their pinned `mode: "legacy"`
  becomes `mode: "profile"` (with `stderr` still empty). Legacy behavior
  moves to a new dedicated test that strips the `comparison` key from the
  baseline before writing it.

## Test strategy

`src/tests/cli.test.ts` (extend, no new file):

- **Update** `"marks baseline issues and fails only on new issues"`: expected
  `comparison.mode` becomes `"profile"`; everything else (exit `0`,
  `isNew: false`, empty stderr) unchanged.
- **Rename and update** `"reports legacy comparison counts including resolved
  issues"` → `"reports profile comparison counts including resolved issues"`:
  `mode: "profile"`, stderr still empty.
- **New** `"compares legacy baselines with a stderr warning"`: same fixture,
  but the baseline JSON is rewritten without its `comparison` key. Expect
  `mode: "legacy"`, the 1/1/1 counts, exit `1` under `--fail-on new`, and
  stderr containing `legacy mode`.
- **New** `"fails with exit code 2 when baseline settings changed"`: baseline
  from an `--scanner empty-notes` run; second run adds `--scanner
  broken-links,empty-notes` (different detection settings → different
  profile). Expect exit `2`, `payload.comparison` equal to
  `{ available: false, mode: "profile", reason: "settings-changed",
  newIssues: 0, persistingIssues: 0, resolvedIssues: 0, scanProfile:
  expect.any(String), comparisonVersion: 2 }`, `payload.issues[0]` without an
  `isNew` key, stderr containing `settings-changed`.
- **New** `"fails with exit code 2 when baseline comparison semantics
  changed"`: baseline rewritten with `comparison.comparisonVersion = 3`;
  second run with `--fail-on none` still exits `2` with `reason:
  "semantics-changed"` — pinning that the setup failure overrides `none`.
- **New** `"rejects malformed baseline comparison metadata"`: baseline with
  `comparison: { scanProfile: 1 }` → exit `2`, empty stdout, stderr
  containing `Invalid baseline`.

`src/tests/result-diff.test.ts` (extend): a new `describe` for
`resolveBaselineCompatibility` — `null` when version and profile match,
`"semantics-changed"` when only the version differs, `"semantics-changed"`
when both differ (precedence), `"settings-changed"` when only the profile
differs. The pre-existing `compareScanResult` suite must pass unedited,
pinning the refactor.

## Verification strategy

```bash
npm test -- src/tests/cli.test.ts src/tests/result-diff.test.ts
npm run build && node cli.js --help
npm run lint && npm run lint:obsidian-warnings && npm test
```

Expected: mismatched baselines cannot create false lifecycle results; legacy
baseline users receive a compatible migration path.

## Precision-suite and CLI impact

- **Precision suite: none.** Scanners, `ScanRunner`, fingerprints, snapshot
  shape, and `scan-profile.ts` are untouched. The only `src/` change is the
  `resolveBaselineCompatibility` extraction in `result-diff.ts`, whose
  behavior is pinned identical by the unedited `compareScanResult` tests.
- **CLI compatibility: behavior-compatible for every comparable scan.**
  Legacy baselines produce the same counts and `isNew` annotations as 4.1
  (plus one new stderr warning line — stderr content was never a stable
  contract, and warnings are actionable). Current-format baselines gain
  `mode: "profile"`. Mismatched current baselines change behavior on purpose:
  exit `2` instead of a misleading `1`/`0` under `--fail-on`, no `isNew`
  annotations, zero counts — the exact roadmap requirement. No stable field
  is removed; `isNew` is omitted only in the new mismatch state.
- **Task 4.3 hand-off**: documentation of profile-aware baselines, the legacy
  migration path, and the exit-`2` setup-failure contract in
  `skills/vault-inspector/SKILL.md` and README.

## Risks

- **Exit-code `2` for mismatches is a behavior change** for CI pipelines that
  compared across settings changes and relied on exit `1` under `--fail-on
  new`. Deliberate: those runs were reporting setup mistakes as vault
  regressions. The stderr warning plus `comparison.reason` make the fix
  obvious (regenerate the baseline or drop `--baseline`).
- **`mode: "profile"` + `available: false`** had no precedent; consumers that
  switch on `mode` alone could misread a mismatch as comparable. Mitigated by
  the documented rule "gate on `available`, use `mode`/`reason` for
  diagnosis", which Task 4.3 writes into the skill documentation.
- **`summary.newIssues` is meaningless under a mismatch** (counts `isNew !==
  false`). Accepted: the field is stable automation output and must not be
  recomputed conditionally; exit `2` prevents anyone from acting on it.
