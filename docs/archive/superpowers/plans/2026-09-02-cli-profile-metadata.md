# CLI Profile Metadata Implementation Plan (Milestone 4, Task 4.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose additive scan-profile and comparison metadata in the CLI JSON output. `cli/cli.ts` gains an exported `CliComparison` type (`available`, `mode: "profile" | "legacy" | "none"`, optional `reason: "missing-baseline" | "settings-changed" | "semantics-changed"`, `newIssues`, `persistingIssues`, `resolvedIssues`, plus always-present `scanProfile` and `comparisonVersion`) computed by a new pure `buildCliComparison(result, baseline, scanProfile)`. Without `--baseline` the payload carries `comparison: { available: false, mode: "none", reason: "missing-baseline", newIssues: 0, persistingIssues: 0, resolvedIssues: 0, scanProfile, comparisonVersion }`. With `--baseline` (today always a fingerprint-only prior JSON report) it carries `available: true, mode: "legacy"` with counts derived from the same fingerprint set that drives `isNew` — `newIssues`/`persistingIssues` over the full unfiltered result (issues + ignoredIssues), `resolvedIssues` = baseline fingerprints absent from the current run. The emitted `scanProfile` is `createScanProfile(makeSettings(parsed))` — the same hash the plugin uses — and `comparisonVersion` is the imported `COMPARISON_VERSION`. Nothing is removed: every existing top-level key, per-issue `isNew`, `summary` (including `summary.newIssues`), `--fail-on` behavior, exit codes, markdown output, and the stdout-JSON/stderr-progress discipline are unchanged. `mode: "profile"` and the `settings-changed`/`semantics-changed` reasons are reserved in the type for Task 4.2 (compatibility-aware baselines); Task 4.3 documents `comparison` in `skills/vault-inspector/SKILL.md` and README.

**Architecture:** All logic stays in `cli/cli.ts` — no `src/` module changes (`createScanProfile` and `COMPARISON_VERSION` are already exported; see ground-rule deviations). `runCli` hoists `makeSettings(parsed)` into a `scanSettings` const, computes the profile before the scan, passes `null` (not an empty set) when no baseline was requested so `buildCliComparison` can distinguish "no baseline" from "empty baseline", and forwards `baselineFingerprints ?? new Set<string>()` to `applyOutputFilters` so `isNew` behavior is bit-identical. `formatResult`/`toJsonPayload` gain a `comparison` parameter; only the JSON branch emits it, appended after `ignoredIssues`. Counts mirror `compareScanResult` in `src/scanner/result-diff.ts` (full result vs baseline fingerprint set) so CLI and plugin lifecycle vocabulary agree.

**Tech Stack:** TypeScript, Node (fs/promises), Vitest

Design doc: `docs/superpowers/specs/2026-09-02-cli-profile-metadata-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 4, Task 4.1)

---

## Ground rules

- Branch: `feat/cli-lifecycle-parity`, cut from latest `main`.
- One commit: `feat: expose CLI scan profile metadata`.
- Additive only: do not remove or rename any existing JSON key (`schemaVersion`, `tool`, `toolVersion`, `vaultPath`, `generatedAt`, `summary`, `issues`, `ignoredIssues`), any issue field (`isNew` included), or change `--fail-on`/exit-code behavior. `schemaVersion` stays `1`.
- The `comparison` object is machine-readable: booleans, the closed `mode` union, the closed optional `reason` union, integer counts, plus `scanProfile: string` and `comparisonVersion: number`. No human prose in the object; no new stderr output in this task.
- JSON stays on stdout (or the `--output` file); progress/warnings stay on stderr. Do not print the comparison to stderr.
- Counts are computed over the FULL unfiltered `ScanResult` (`issues` + `ignoredIssues`), mirroring `compareScanResult` in `src/scanner/result-diff.ts`. Filters (`--severity`/`--include`/`--exclude`) must not inflate `resolvedIssues`.
- `mode` is `"legacy"` for every baseline in 4.1 (today's baselines carry no profile metadata). Never emit `mode: "profile"` or `reason: "settings-changed"`/`"semantics-changed"` — those are Task 4.2.
- `reason` is present only when `available` is `false`.
- Deviation from the roadmap file list: `src/scanner/scan-profile.ts`, `src/snapshot/scan-snapshot.ts`, and `src/tests/cli-package.test.ts` are listed but need NO changes — `createScanProfile` (`src/scanner/scan-profile.ts` line 16) and `COMPARISON_VERSION` (`src/snapshot/scan-snapshot.ts` line 18, currently `2`) are already exported and merely imported by the CLI; `cli-package.test.ts` pins the npm packaging contract, which this task does not touch.
- Do not modify `src/scanner/scanners/*`, `src/scanner/ScanRunner.ts`, `src/scanner/result-diff.ts`, `src/scanner/scan-session.ts`, `src/snapshot/*`, `src/report/*`, `src/fix/*`, `src/settings/*`, `src/main.ts`, `styles.css`, `skills/vault-inspector/SKILL.md`, `README.md`, or `cli/local-vault.ts`.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.
- Never `eslint-disable` any `obsidianmd/*` rule.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/cli-lifecycle-parity
```

---

### Task 2: Write the failing CLI tests first (TDD)

**Files:**
- Modify: `src/tests/cli.test.ts`

- [ ] **Step 1: Replace the no-comparison assertions with exact `none`/`missing-baseline` shape**

In `src/tests/cli.test.ts`, inside the test `"prints machine-readable JSON scan results"`, replace (lines 87–88):

```typescript
			expect(payload).not.toHaveProperty("comparison");
			expect(payload).not.toHaveProperty("resolvedIssues");
```

with:

```typescript
			expect(payload.comparison).toEqual({
				available: false,
				mode: "none",
				reason: "missing-baseline",
				newIssues: 0,
				persistingIssues: 0,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			expect(payload).not.toHaveProperty("resolvedIssues");
```

(The top-level `resolvedIssues` prohibition stays: resolved counts live only nested under `comparison`. `comparisonVersion: 2` pins the current `COMPARISON_VERSION`; update it in lockstep with `src/snapshot/scan-snapshot.ts` when that constant changes.)

- [ ] **Step 2: Extend the existing baseline test with legacy counts**

In `src/tests/cli.test.ts`, inside the test `"marks baseline issues and fails only on new issues"`, replace (lines 1045–1050):

```typescript
			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(0);
			expect(payload.summary.issues).toBe(1);
			expect(payload.summary.newIssues).toBe(0);
			expect(payload.issues[0].isNew).toBe(false);
```

with:

```typescript
			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(0);
			expect(payload.summary.issues).toBe(1);
			expect(payload.summary.newIssues).toBe(0);
			expect(payload.issues[0].isNew).toBe(false);
			expect(second.stderr).toBe("");
			expect(payload.comparison).toEqual({
				available: true,
				mode: "legacy",
				newIssues: 0,
				persistingIssues: 1,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
```

- [ ] **Step 3: Add a legacy-counts test covering new, persisting, and resolved**

In `src/tests/cli.test.ts`, insert immediately after the closing `});` of the test `"marks baseline issues and fails only on new issues"` (line 1051) and before the describe block's final `});` (line 1052):

```typescript
	it("reports legacy comparison counts including resolved issues", async () => {
		await withVault({ "keep.md": "", "drop.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, first.stdout, "utf8");

			await rm(join(vaultPath, "drop.md"), { force: true });
			await writeFile(join(vaultPath, "added.md"), "");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"new",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(1);
			expect(second.stderr).toBe("");
			expect(payload.comparison).toEqual({
				available: true,
				mode: "legacy",
				newIssues: 1,
				persistingIssues: 1,
				resolvedIssues: 1,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			// The same fingerprint set drives isNew and the counts.
			expect(payload.issues.find(
				(issue: { isNew?: boolean }) => issue.isNew === true,
			).primaryPath).toBe("added.md");
			expect(payload.issues.find(
				(issue: { isNew?: boolean }) => issue.isNew === false,
			).primaryPath).toBe("keep.md");
		});
	});
```

Fixture arithmetic: the baseline run sees two empty notes (`keep.md`,
`drop.md`). The second run sees `keep.md` (fingerprint present in the
baseline → `persistingIssues: 1`, `isNew: false`), `added.md` (fingerprint
absent → `newIssues: 1`, `isNew: true`, exit 1 under `--fail-on new`), and
`drop.md` is gone (`resolvedIssues: 1`). Empty-note fingerprints are
deterministic per primary path (empty content, same evidence), so the counts
are exact.

- [ ] **Step 4: Run and confirm failure**

```bash
npm test -- src/tests/cli.test.ts
```

Expected: FAIL — `payload.comparison` is `undefined` in all three tests (the current payload has no `comparison` key), pinning the missing metadata before implementation.

---

### Task 3: Implement `CliComparison` in `cli/cli.ts`

**Files:**
- Modify: `cli/cli.ts`

- [ ] **Step 1: Add the imports**

In `cli/cli.ts`, after (lines 12–14):

```typescript
import { formatDuration } from "../src/utils/format";
import { matchesGlob } from "../src/utils/paths";
import type { ExternalRequestAdapter } from "../src/scanner/ScanContext";
```

add:

```typescript
import { createScanProfile } from "../src/scanner/scan-profile";
import { COMPARISON_VERSION } from "../src/snapshot/scan-snapshot";
```

- [ ] **Step 2: Add the `CliComparison` type**

In `cli/cli.ts`, after (lines 16–18):

```typescript
type OutputFormat = "json" | "markdown";
type FailOn = "any" | "error" | "warning" | "new" | "none";
type Severity = "error" | "warning" | "info";
```

add:

```typescript
export type CliComparisonMode = "profile" | "legacy" | "none";
export type CliComparisonReason =
	| "missing-baseline"
	| "settings-changed"
	| "semantics-changed";

/**
 * Additive top-level comparison metadata for CLI JSON output. `available`
 * mirrors the plugin's LifecycleComparison semantics: whether the
 * new/persisting/resolved counts are trustworthy lifecycle claims. Counts
 * cover the full unfiltered result (issues + ignoredIssues), so they can
 * differ from the filtered `summary.newIssues`. `mode: "profile"` and the
 * settings/semantics reasons are reserved for compatibility-aware baseline
 * reading (roadmap Task 4.2); 4.1 baselines are fingerprint-only
 * ("legacy").
 */
export type CliComparison = {
	available: boolean;
	mode: CliComparisonMode;
	reason?: CliComparisonReason;
	newIssues: number;
	persistingIssues: number;
	resolvedIssues: number;
	scanProfile: string;
	comparisonVersion: number;
};
```

- [ ] **Step 3: Compute the profile and comparison in `runCli`**

In `cli/cli.ts`, replace (lines 105–115):

```typescript
		const scanStartedAt = Date.now();
		const scanResult = await scanRunner.run(app, makeSettings(parsed), {
			onProgress: parsed.progress
				? (progress) => writeStderr(formatProgressLine(progress))
				: undefined,
		});
		const baselineFingerprints = parsed.baselinePath
			? await readBaselineFingerprints(parsed.baselinePath)
			: new Set<string>();
		const result = applyOutputFilters(scanResult, parsed, baselineFingerprints);
		const output = formatResult(result, vaultPath, parsed.format);
```

with:

```typescript
		const scanStartedAt = Date.now();
		const scanSettings = makeSettings(parsed);
		const scanProfile = await createScanProfile(scanSettings);
		const scanResult = await scanRunner.run(app, scanSettings, {
			onProgress: parsed.progress
				? (progress) => writeStderr(formatProgressLine(progress))
				: undefined,
		});
		const baselineFingerprints = parsed.baselinePath
			? await readBaselineFingerprints(parsed.baselinePath)
			: null;
		const comparison = buildCliComparison(scanResult, baselineFingerprints, scanProfile);
		const result = applyOutputFilters(
			scanResult,
			parsed,
			baselineFingerprints ?? new Set<string>(),
		);
		const output = formatResult(result, vaultPath, parsed.format, comparison);
```

(`null` means "no baseline requested"; an empty `Set` means "baseline read,
zero issues". `applyOutputFilters` receives an empty set when no baseline was
requested, so `isNew` behavior is bit-identical to today.)

- [ ] **Step 4: Thread `comparison` through the formatters**

In `cli/cli.ts`, replace (lines 325–332):

```typescript
function formatResult(
	result: CliScanResult,
	vaultPath: string,
	format: OutputFormat,
): string {
	if (format === "markdown") return generateMarkdownReport(result);
	return JSON.stringify(toJsonPayload(result, vaultPath), null, 2);
}
```

with:

```typescript
function formatResult(
	result: CliScanResult,
	vaultPath: string,
	format: OutputFormat,
	comparison: CliComparison,
): string {
	if (format === "markdown") return generateMarkdownReport(result);
	return JSON.stringify(toJsonPayload(result, vaultPath, comparison), null, 2);
}
```

- [ ] **Step 5: Emit `comparison` in the JSON payload**

In `cli/cli.ts`, replace (lines 361–387):

```typescript
function toJsonPayload(result: CliScanResult, vaultPath: string): Record<string, unknown> {
	const errors = result.issues.filter((issue) => issue.severity === "error").length;
	const warnings = result.issues.filter((issue) => issue.severity === "warning").length;
	const info = result.issues.filter((issue) => issue.severity === "info").length;
	const newIssues = result.issues.filter((issue) => issue.isNew !== false).length;

	return {
		schemaVersion: 1,
		tool: "vault-inspector",
		toolVersion: TOOL_VERSION,
		vaultPath,
		generatedAt: new Date(result.finishedAt).toISOString(),
		summary: {
			filesScanned: result.filesScanned,
			scannersRun: result.scannersRun,
			issues: result.issues.length,
			ignoredIssues: result.ignoredIssues.length,
			errors,
			warnings,
			info,
			newIssues,
			durationMs: result.finishedAt - result.startedAt,
		},
		issues: result.issues,
		ignoredIssues: result.ignoredIssues,
	};
}
```

with:

```typescript
function toJsonPayload(
	result: CliScanResult,
	vaultPath: string,
	comparison: CliComparison,
): Record<string, unknown> {
	const errors = result.issues.filter((issue) => issue.severity === "error").length;
	const warnings = result.issues.filter((issue) => issue.severity === "warning").length;
	const info = result.issues.filter((issue) => issue.severity === "info").length;
	const newIssues = result.issues.filter((issue) => issue.isNew !== false).length;

	return {
		schemaVersion: 1,
		tool: "vault-inspector",
		toolVersion: TOOL_VERSION,
		vaultPath,
		generatedAt: new Date(result.finishedAt).toISOString(),
		summary: {
			filesScanned: result.filesScanned,
			scannersRun: result.scannersRun,
			issues: result.issues.length,
			ignoredIssues: result.ignoredIssues.length,
			errors,
			warnings,
			info,
			newIssues,
			durationMs: result.finishedAt - result.startedAt,
		},
		issues: result.issues,
		ignoredIssues: result.ignoredIssues,
		comparison,
	};
}
```

- [ ] **Step 6: Add `buildCliComparison`**

In `cli/cli.ts`, insert immediately after the `readBaselineFingerprints` function (after line 432, its closing `}`):

```typescript
/**
 * Builds the additive comparison metadata for one CLI run. Without a
 * baseline the comparison is honestly unavailable (zero counts, never
 * "everything is new"). With a baseline — always fingerprint-only today —
 * the mode is "legacy" and the counts cover the FULL unfiltered result
 * (issues + ignoredIssues), mirroring compareScanResult in
 * src/scanner/result-diff.ts so output filters never inflate
 * resolvedIssues.
 */
function buildCliComparison(
	result: ScanResult,
	baseline: Set<string> | null,
	scanProfile: string,
): CliComparison {
	const metadata = {
		scanProfile,
		comparisonVersion: COMPARISON_VERSION,
	};

	if (baseline === null) {
		return {
			available: false,
			mode: "none",
			reason: "missing-baseline",
			newIssues: 0,
			persistingIssues: 0,
			resolvedIssues: 0,
			...metadata,
		};
	}

	const currentFingerprints = new Set([
		...result.issues.map((issue) => issue.fingerprint),
		...result.ignoredIssues.map((issue) => issue.fingerprint),
	]);

	let newIssues = 0;
	let persistingIssues = 0;
	for (const fingerprint of currentFingerprints) {
		if (baseline.has(fingerprint)) {
			persistingIssues++;
		} else {
			newIssues++;
		}
	}

	let resolvedIssues = 0;
	for (const fingerprint of baseline) {
		if (!currentFingerprints.has(fingerprint)) resolvedIssues++;
	}

	return {
		available: true,
		mode: "legacy",
		newIssues,
		persistingIssues,
		resolvedIssues,
		...metadata,
	};
}
```

- [ ] **Step 7: Run the focused CLI suites**

```bash
npm test -- src/tests/cli.test.ts src/tests/cli-package.test.ts
```

Expected: PASS — all three comparison tests green and every pre-existing CLI
test green unedited. If any pre-existing test fails, STOP: the change stopped
being additive; fix the implementation, never the pinned test.

---

### Task 4: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/cli.test.ts src/tests/cli-package.test.ts
```

Expected: PASS — old fields remain present and the new profile metadata is
additive.

- [ ] **Step 2: Verify the built CLI help and JSON shape end to end**

```bash
npm run build
node cli.js --help
```

(`--help` prints usage unchanged with exit 0. Optionally, against any throwaway
vault: `node cli.js /path/to/vault --format json | jq '.comparison'` must show
the `none`/`missing-baseline` object with a non-empty `scanProfile` and
`comparisonVersion: 2`.)

- [ ] **Step 3: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0, zero ESLint warnings, build regenerates usable
`main.js` and `cli.js`, full suite green (coverage thresholds 40/40/50 hold —
`cli/cli.ts` gains only covered branches).

- [ ] **Step 4: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `cli/cli.ts` and `src/tests/cli.test.ts`, plus this plan/spec
pair if committed together. NOT `src/scanner/*`, `src/snapshot/*`,
`src/report/*`, `src/settings/*`, `src/main.ts`, `cli/local-vault.ts`,
`cli/bin.ts`, `skills/vault-inspector/SKILL.md`, `README.md`, or
`package.json`.

- [ ] **Step 5: Commit and push**

```bash
git add cli/cli.ts src/tests/cli.test.ts
git commit -m "feat: expose CLI scan profile metadata"
git push -u origin feat/cli-lifecycle-parity
```

- [ ] **Step 6: Open the PR** against `main`, titled
  `feat: expose CLI scan profile metadata`, covering: additive top-level
  `comparison` object (`CliComparison`: `available`, `mode`
  `none`/`legacy` — `profile` reserved for Task 4.2, optional `reason`
  `missing-baseline` — `settings-changed`/`semantics-changed` reserved for
  4.2, `newIssues`/`persistingIssues`/`resolvedIssues`, `scanProfile`,
  `comparisonVersion`); counts computed over the full unfiltered result
  mirroring `compareScanResult`, so filters never inflate `resolvedIssues`;
  `isNew`, `summary.newIssues`, `--fail-on`, exit codes, markdown output, and
  stdout/stderr discipline unchanged; documented roadmap file-list deviations
  (`src/scanner/scan-profile.ts`, `src/snapshot/scan-snapshot.ts`,
  `src/tests/cli-package.test.ts` need no changes — exports already exist,
  packaging contract untouched); the flipped pre-4.1 assertion
  (`not.toHaveProperty("comparison")` → exact `none`/`missing-baseline`
  shape). Include the roadmap PR-description items: focused tests run, full
  verification results, non-goals, compatibility impact, and remaining
  boundaries (Task 4.2 compatibility-aware baselines, Task 4.3 skill/README
  documentation).

## Self-review checklist (completed during plan writing)

- Roadmap Task 4.1 requirement ↔ implementation mapping: additive top-level `CliComparison` metadata ✓ (Task 3 Step 2 type + Step 5 payload placement after `ignoredIssues`); emit scan profile and comparison version without removing stable fields ✓ (Step 3 `createScanProfile(makeSettings(parsed))` + `COMPARISON_VERSION` in `metadata`, every existing key preserved in the quoted `toJsonPayload` replacement); retain `isNew` ✓ (`applyOutputFilters` untouched — only its argument changes to `baselineFingerprints ?? new Set<string>()`, keeping the `size === 0 ? true : …` annotation bit-identical; pinned by the extended baseline test asserting `payload.issues[0].isNew).toBe(false)`); machine-readable schema additions, messages informational ✓ (closed string unions, integer counts, no prose in the object, no new stderr output); JSON on stdout, progress/warnings on stderr ✓ (comparison rides the existing `formatResult` JSON branch; tests assert `second.stderr).toBe("")`); clean `none`/`missing-baseline` without a baseline ✓ (Step 6 `baseline === null` branch, pinned by the rewritten no-comparison assertions); mode/reason/counts from the existing baseline path when one is passed ✓ (`legacy` + fingerprint-set counts over the full result, pinned by the extended baseline test and the new legacy-counts test).
- No placeholders: Task 3 is six exact anchored replacements/additions quoting current `cli/cli.ts` code with line anchors; Task 2 is three complete test edits with the current assertion blocks quoted and fully determined fixture arithmetic (baseline `{keep,drop}`, second run `{keep,added}` → new/persisting/resolved = 1/1/1).
- Type/name consistency verified against real code: current JSON top-level keys are exactly `schemaVersion`, `tool`, `toolVersion`, `vaultPath`, `generatedAt`, `summary`, `issues`, `ignoredIssues` (`cli/cli.ts` `toJsonPayload`, lines 367–386) — the plan's replacement preserves all of them verbatim; `readBaselineFingerprints` reads `parsed.issues[].fingerprint` from a prior CLI JSON report (`cli/cli.ts` lines 424–432), which is why every 4.1 baseline is `mode: "legacy"`; `createScanProfile` is exported from `src/scanner/scan-profile.ts` (line 16) and takes `InspectorSettings` — `makeSettings` already returns exactly that (`cli/cli.ts` line 292); `COMPARISON_VERSION` is exported from `src/snapshot/scan-snapshot.ts` (line 18) and is currently `2`, matching the test pins; `ScanResult` carries `issues` + `ignoredIssues` with `fingerprint: string`, so `buildCliComparison` type-checks against the unfiltered result; `formatResult`/`toJsonPayload` signatures match their (single) call sites after the Step 3/4/5 chain.
- Baseline `null` vs empty-set distinction audited: `applyOutputFilters`' `annotate` treats an empty set as "all new" — forwarding `new Set<string>()` when no baseline was requested reproduces today's behavior exactly; `buildCliComparison` receives the `null` so an empty baseline file still reports `mode: "legacy"` with `newIssues = <current count>`.
- Count semantics mirror the plugin: `compareScanResult` (`src/scanner/result-diff.ts` lines 43–60) compares `current.issues` + `current.ignoredIssues` against the snapshot; `buildCliComparison` does the same against the baseline fingerprint set, so filters (`--severity`/`--include`/`--exclude`) shape only `issues`/`summary`, never `resolvedIssues`.
- Markdown path untouched: `generateMarkdownReport(result)` keeps its single-argument call; markdown tests in `src/tests/cli.test.ts` (e.g. "writes markdown output when an output path is provided") pass unedited.
- `src/tests/cli-package.test.ts` audited (33 lines): it pins `pkg.bin`, `pkg.files`, `cli/bin.ts` existence, and esbuild entry points — none change; the roadmap's `node cli.js --help` verification is covered in Task 4 Step 2 after `npm run build`.
- `skills/vault-inspector/SKILL.md` noted, not changed: its stable-field list ("Use stable fields for automation: … `isNew`, and `summary.newIssues`") gains `comparison` in roadmap Task 4.3, which owns skill/README documentation alignment; 4.1 leaves the skill text as-is so agents are never told about a field before it ships.
- Obsidian lint constraints: only `cli/cli.ts` changes outside tests — `cli/` is outside the `lint:obsidian-warnings` `src/**` scope and may import Node APIs; no new `obsidian` imports anywhere; no `eslint-disable`.
- Precision-suite/CLI impact: precision suite untouched (scanners, `ScanRunner`, fingerprints unchanged; `src/tests/scan-profile.test.ts` passes unedited since `createScanProfile` is only imported); CLI compatibility strictly additive — every stable automation field (`schemaVersion`, `toolVersion`, `summary`, `fingerprint`, `scannerId`, `severity`, `classification`, `explanation`, `primaryPath`, `relatedPaths`, `evidence`, `fixAction`, `isNew`, `summary.newIssues`) emitted unchanged, `--fail-on new` and exit codes bit-compatible.
