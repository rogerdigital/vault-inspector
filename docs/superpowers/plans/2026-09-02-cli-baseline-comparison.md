# CLI Baseline Comparison Implementation Plan (Milestone 4, Task 4.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CLI's `--baseline` comparison compatibility-aware. `readBaselineFingerprints` in `cli/cli.ts` is replaced by `readBaseline(path)` returning a `BaselineReport` union: `{ kind: "legacy", fingerprints }` for baselines without a `comparison` object (pre-4.1 reports — fingerprint extraction frozen to `issues`, byte-identical to today), `{ kind: "current", fingerprints, scanProfile, comparisonVersion }` for baselines carrying well-formed `comparison.scanProfile`/`comparison.comparisonVersion` metadata (fingerprints from `issues` + `ignoredIssues`, mirroring `createScanSnapshot`), and a thrown `Error("Invalid baseline: comparison metadata is malformed")` for a present-but-malformed `comparison` object, which rides the existing outer `catch` to the existing exit-2 setup-failure path. A shared gate `resolveBaselineCompatibility(baselineComparisonVersion, baselineScanProfile, currentProfile)` (new export in `src/scanner/result-diff.ts`, also used by `compareScanResult` in place of its two inline guards — semantics identical) returns `null`, `"semantics-changed"` (version mismatch, checked first), or `"settings-changed"` (profile mismatch). `buildCliComparison` gains the mismatch parameter: matched current baselines emit `{ available: true, mode: "profile", newIssues, persistingIssues, resolvedIssues, scanProfile, comparisonVersion }`; mismatches emit `{ available: false, mode: "profile", reason: <mismatch>, zero counts, … }` with exit code forced to `2` (overriding `--fail-on`, including `none`) and `isNew` omitted from every issue (no fabricated lifecycle annotations). Legacy baselines keep 4.1 behavior plus one always-on stderr warning (`Baseline <path> has no scan profile metadata; comparing fingerprints only (legacy mode). Regenerate the baseline to enable profile-aware comparison.`), and mismatches get `Baseline is not comparable (reason: <mismatch>). Regenerate the baseline or rerun without --baseline.` on stderr. `--fail-on new`, severity thresholds, exit codes for comparable scans, markdown output, and all stable automation fields are unchanged.

**Architecture:** All new comparison logic stays in `cli/cli.ts`; the compatibility gate lives in `src/scanner/result-diff.ts` so the plugin (`compareScanResult`) and the CLI share one precedence rule. `runCli` reads the baseline after the scan (unchanged location), resolves the mismatch, writes the stderr warnings, and computes `exitCode = mismatch ? 2 : getExitCode(result, parsed.failOn)`. `applyOutputFilters`' baseline parameter widens to `Set<string> | null`, where `null` (mismatch only) means "do not annotate `isNew`"; no-baseline runs still receive an empty set so `isNew: true` behavior is bit-identical to 4.1.

**Tech Stack:** TypeScript, Node (fs/promises), Vitest

Design doc: `docs/superpowers/specs/2026-09-02-cli-baseline-comparison-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 4, Task 4.2)

---

## Ground rules

- Branch: `feat/cli-baseline-comparison`, cut from latest `main`.
- One commit: `feat: compare compatible CLI scan baselines`.
- Legacy behavior is frozen: a baseline without a `comparison` object reads fingerprints from `issues` only and produces the same counts and `isNew` annotations as Task 4.1, plus exactly one new stderr warning line. Do not change legacy `isNew` semantics.
- Exit codes: comparable scans and no-baseline runs keep today's `getExitCode` behavior (`--fail-on new`, `any`, `error`, `warning`, `none` untouched). Only a current-format mismatch forces exit `2`, and it overrides every `--fail-on` mode including `none`.
- Under a mismatch, no issue carries `isNew` and all comparison counts are `0`; `comparison` carries `{ available: false, mode: "profile", reason, newIssues: 0, persistingIssues: 0, resolvedIssues: 0, scanProfile, comparisonVersion }`. `mode` describes the baseline's format; `available` describes whether lifecycle counts are trustworthy.
- Reason precedence mirrors `compareScanResult`: `comparisonVersion` mismatch → `semantics-changed`, checked before `scanProfile` mismatch → `settings-changed`.
- Malformed baseline `comparison` metadata (present but not a plain object with non-empty string `scanProfile` and safe positive integer `comparisonVersion`) throws `Error("Invalid baseline: comparison metadata is malformed")` into the existing outer `catch` (exit `2`, empty stdout, `Scan failed: …` on stderr). Never silently treat it as legacy.
- Current-format baselines include `ignoredIssues` fingerprints; legacy baselines do not.
- The two new stderr warnings are always written (not gated by `--progress`); JSON stays on stdout (or the `--output` file); no human prose enters the `comparison` object.
- `compareScanResult`'s observable behavior must not change: every pre-existing test in `src/tests/result-diff.test.ts` passes unedited.
- Deviation from the roadmap file list: `src/scanner/scan-profile.ts` and `src/snapshot/scan-snapshot.ts` need NO changes (`createScanProfile` and `COMPARISON_VERSION` are already imported by the CLI); `src/scanner/result-diff.ts` is modified additively (new `resolveBaselineCompatibility` export) plus a semantics-preserving refactor of `compareScanResult` onto it.
- Do not modify `src/scanner/scanners/*`, `src/scanner/ScanRunner.ts`, `src/scanner/scan-session.ts`, `src/snapshot/*`, `src/report/*`, `src/fix/*`, `src/settings/*`, `src/main.ts`, `styles.css`, `skills/vault-inspector/SKILL.md`, `README.md`, `cli/local-vault.ts`, or `cli/bin.ts`.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.
- Never `eslint-disable` any `obsidianmd/*` rule.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/cli-baseline-comparison
```

---

### Task 2: Write the failing `result-diff` tests first (TDD)

**Files:**
- Modify: `src/tests/result-diff.test.ts`

- [ ] **Step 1: Add the `resolveBaselineCompatibility` describe block**

In `src/tests/result-diff.test.ts`, replace the import (line 3):

```typescript
import { compareScanResult } from "../scanner/result-diff";
```

with:

```typescript
import {
	compareScanResult,
	resolveBaselineCompatibility,
} from "../scanner/result-diff";
```

Then insert immediately after the closing `});` of the `describe("compareScanResult", …)` block (line 182, end of file):

```typescript
describe("resolveBaselineCompatibility", () => {
	it("accepts a matching comparison version and scan profile", () => {
		expect(resolveBaselineCompatibility(2, "profile", "profile")).toBeNull();
	});

	it("rejects a changed comparison version before checking settings", () => {
		expect(resolveBaselineCompatibility(3, "profile", "profile")).toBe(
			"semantics-changed",
		);
	});

	it("prefers semantics-changed when both version and profile differ", () => {
		expect(resolveBaselineCompatibility(3, "old-profile", "new-profile")).toBe(
			"semantics-changed",
		);
	});

	it("rejects a changed scan profile", () => {
		expect(resolveBaselineCompatibility(2, "old-profile", "new-profile")).toBe(
			"settings-changed",
		);
	});
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/result-diff.test.ts
```

Expected: FAIL — `resolveBaselineCompatibility` is not exported from
`src/scanner/result-diff.ts`. The pre-existing `compareScanResult` tests still
pass (nothing has changed for the plugin yet).

---

### Task 3: Extract `resolveBaselineCompatibility` in `src/scanner/result-diff.ts`

**Files:**
- Modify: `src/scanner/result-diff.ts`

- [ ] **Step 1: Add the exported helper**

In `src/scanner/result-diff.ts`, insert immediately after the
`ComparisonUnavailableReason` type (after line 13, before `export type
LifecycleComparison`):

```typescript
/**
 * Shared compatibility gate for baseline comparisons. Order matters and
 * mirrors compareScanResult: a comparison-version (semantics) mismatch is
 * reported before a scan-profile (settings) mismatch, because fingerprint
 * identity itself cannot be trusted across semantics changes.
 */
export type BaselineMismatchReason = "settings-changed" | "semantics-changed";

export function resolveBaselineCompatibility(
	baselineComparisonVersion: number,
	baselineScanProfile: string,
	currentProfile: string,
): BaselineMismatchReason | null {
	if (baselineComparisonVersion !== COMPARISON_VERSION) return "semantics-changed";
	if (baselineScanProfile !== currentProfile) return "settings-changed";
	return null;
}
```

- [ ] **Step 2: Refactor `compareScanResult` onto the helper**

In `src/scanner/result-diff.ts`, replace (lines 30–35):

```typescript
	if (snapshot.comparisonVersion !== COMPARISON_VERSION) {
		return { ...unavailable("semantics-changed"), previousScanAt: snapshot.createdAt };
	}
	if (snapshot.scanProfile !== currentProfile) {
		return { ...unavailable("settings-changed"), previousScanAt: snapshot.createdAt };
	}
```

with:

```typescript
	const mismatch = resolveBaselineCompatibility(
		snapshot.comparisonVersion,
		snapshot.scanProfile,
		currentProfile,
	);
	if (mismatch) {
		return { ...unavailable(mismatch), previousScanAt: snapshot.createdAt };
	}
```

(`ComparisonUnavailableReason` already covers both mismatch values, so
`unavailable(mismatch)` type-checks; the mapping is identical to the two
inline guards.)

- [ ] **Step 3: Run the suite**

```bash
npm test -- src/tests/result-diff.test.ts
```

Expected: PASS — all four new helper tests green and every pre-existing
`compareScanResult` test green unedited. If any pre-existing test fails,
STOP: the refactor changed plugin semantics; fix the helper, never the test.

---

### Task 4: Write the failing CLI tests (TDD)

**Files:**
- Modify: `src/tests/cli.test.ts`

- [ ] **Step 1: Flip the matched-baseline test to profile mode**

In `src/tests/cli.test.ts`, inside the test `"marks baseline issues and fails
only on new issues"`, replace (lines 1060–1068):

```typescript
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

with:

```typescript
			expect(payload.comparison).toEqual({
				available: true,
				mode: "profile",
				newIssues: 0,
				persistingIssues: 1,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
```

(The baseline is written from `first.stdout` of the current CLI, which since
Task 4.1 carries `comparison.scanProfile` + `comparison.comparisonVersion`, so
the second run now proves compatibility instead of defaulting to legacy.
`second.stderr` stays `""` — a matched current baseline is not warned about.)

- [ ] **Step 2: Rename and flip the counts test to profile mode**

In `src/tests/cli.test.ts`, replace the test title (line 1072):

```typescript
	it("reports legacy comparison counts including resolved issues", async () => {
```

with:

```typescript
	it("reports profile comparison counts including resolved issues", async () => {
```

and inside that test replace (lines 1102–1110):

```typescript
			expect(payload.comparison).toEqual({
				available: true,
				mode: "legacy",
				newIssues: 1,
				persistingIssues: 1,
				resolvedIssues: 1,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
```

with:

```typescript
			expect(payload.comparison).toEqual({
				available: true,
				mode: "profile",
				newIssues: 1,
				persistingIssues: 1,
				resolvedIssues: 1,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
```

- [ ] **Step 3: Add the legacy, mismatch, and malformed-baseline tests**

In `src/tests/cli.test.ts`, insert immediately after the closing `});` of the
test `"reports profile comparison counts including resolved issues"` (line
1119) and before the describe block's final `});` (line 1120):

```typescript
	it("compares legacy baselines with a stderr warning", async () => {
		await withVault({ "keep.md": "", "drop.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baseline = JSON.parse(first.stdout);
			delete baseline.comparison;
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, JSON.stringify(baseline), "utf8");

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
			expect(second.stderr).toContain(
				"Baseline " + baselinePath + " has no scan profile metadata",
			);
			expect(second.stderr).toContain("legacy mode");
			expect(payload.comparison).toEqual({
				available: true,
				mode: "legacy",
				newIssues: 1,
				persistingIssues: 1,
				resolvedIssues: 1,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			expect(payload.issues.find(
				(issue: { isNew?: boolean }) => issue.isNew === true,
			).primaryPath).toBe("added.md");
			expect(payload.issues.find(
				(issue: { isNew?: boolean }) => issue.isNew === false,
			).primaryPath).toBe("keep.md");
		});
	});

	it("fails with exit code 2 when baseline settings changed", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
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

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"broken-links,empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"new",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(2);
			expect(second.stderr).toContain("settings-changed");
			expect(payload.comparison).toEqual({
				available: false,
				mode: "profile",
				reason: "settings-changed",
				newIssues: 0,
				persistingIssues: 0,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			// No lifecycle annotations are fabricated from an incompatible baseline.
			expect(payload.issues.every(
				(issue: { isNew?: boolean }) => issue.isNew === undefined,
			)).toBe(true);
		});
	});

	it("fails with exit code 2 when baseline comparison semantics changed", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baseline = JSON.parse(first.stdout);
			baseline.comparison.comparisonVersion = 3;
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, JSON.stringify(baseline), "utf8");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"none",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(2);
			expect(second.stderr).toContain("semantics-changed");
			expect(payload.comparison).toEqual({
				available: false,
				mode: "profile",
				reason: "semantics-changed",
				newIssues: 0,
				persistingIssues: 0,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
			expect(payload.issues.every(
				(issue: { isNew?: boolean }) => issue.isNew === undefined,
			)).toBe(true);
		});
	});

	it("rejects malformed baseline comparison metadata", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baseline = JSON.parse(first.stdout);
			baseline.comparison = { scanProfile: 1 };
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, JSON.stringify(baseline), "utf8");

			const second = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--baseline",
				baselinePath,
				"--fail-on",
				"none",
			]);

			expect(second.exitCode).toBe(2);
			expect(second.stdout).toBe("");
			expect(second.stderr).toContain("Invalid baseline");
		});
	});
```

Fixture arithmetic: the legacy test mirrors the profile-counts test
(`{keep,drop}` → `{keep,added}` → new/persisting/resolved = 1/1/1) but with
the `comparison` key stripped, so the same counts must come out of the
fingerprint-only path. The settings test changes `--scanner`
(`empty-notes` → `broken-links,empty-notes`), which flows through
`makeSettings` → `enabledScanners` → `createScanProfile`, guaranteeing a
different profile with identical vault state. The semantics test pins that a
hand-edited `comparisonVersion: 3` both maps to `semantics-changed` and
forces exit `2` even under `--fail-on none`. The malformed test pins the
thrown-error path through the existing outer `catch` (exit `2`, empty
stdout).

- [ ] **Step 4: Run and confirm failure**

```bash
npm test -- src/tests/cli.test.ts
```

Expected: FAIL — the two flipped tests see `mode: "legacy"` (the CLI cannot
yet read metadata), the legacy test sees an empty stderr (no warning yet),
and the mismatch tests see exit codes `0`/`1` instead of `2` with `isNew`
annotations present and non-zero counts.

---

### Task 5: Implement compatibility-aware baselines in `cli/cli.ts`

**Files:**
- Modify: `cli/cli.ts`

- [ ] **Step 1: Add the import**

In `cli/cli.ts`, after (lines 15–16):

```typescript
import { createScanProfile } from "../src/scanner/scan-profile";
import { COMPARISON_VERSION } from "../src/snapshot/scan-snapshot";
```

add:

```typescript
import {
	resolveBaselineCompatibility,
	type BaselineMismatchReason,
} from "../src/scanner/result-diff";
```

- [ ] **Step 2: Add the `BaselineReport` type**

In `cli/cli.ts`, insert immediately after the `CliComparison` type's closing
`}` (after line 47):

```typescript
/**
 * A parsed --baseline file. "current" baselines carry well-formed
 * comparison.scanProfile/comparisonVersion metadata (written by the CLI
 * since Task 4.1) and include ignoredIssues fingerprints, mirroring
 * createScanSnapshot. "legacy" baselines are pre-4.1 reports without the
 * comparison object; their fingerprint extraction is frozen to `issues`.
 */
export type BaselineReport =
	| {
			kind: "current";
			fingerprints: Set<string>;
			scanProfile: string;
			comparisonVersion: number;
		}
	| { kind: "legacy"; fingerprints: Set<string> };
```

- [ ] **Step 3: Rewrite the baseline read and exit-code flow in `runCli`**

In `cli/cli.ts`, replace (lines 142–152):

```typescript
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
		const exitCode = getExitCode(result, parsed.failOn);
```

with:

```typescript
		const baseline = parsed.baselinePath
			? await readBaseline(parsed.baselinePath)
			: null;
		const mismatch = baseline?.kind === "current"
			? resolveBaselineCompatibility(
					baseline.comparisonVersion,
					baseline.scanProfile,
					scanProfile,
				)
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

(`mismatch ? 2 : …` is the setup-failure exit path: it overrides every
`--fail-on` mode including `none`, so a poisoned comparison can neither pass
nor be silenced. The `applyOutputFilters` third argument has three states:
empty set = no baseline requested (`isNew: true` everywhere, 4.1 behavior),
fingerprint set = comparable baseline, `null` = mismatch, do not annotate.)

- [ ] **Step 4: Widen `applyOutputFilters` to allow "do not annotate"**

In `cli/cli.ts`, replace (lines 437–457):

```typescript
function applyOutputFilters(
	result: ScanResult,
	options: CliOptions,
	baselineFingerprints: Set<string>,
): CliScanResult {
	const filterIssue = (issue: ScanResult["issues"][number]) => {
		if (options.severity && !options.severity.includes(issue.severity)) return false;
		const path = issue.primaryPath ?? issue.relatedPaths[0] ?? "";
		if (options.include.length > 0 && !options.include.some((glob) => matchesGlob(path, glob))) {
			return false;
		}
		if (options.exclude.some((glob) => matchesGlob(path, glob))) return false;
		return true;
	};

	const annotate = (issue: ScanResult["issues"][number]): CliIssue => ({
		...issue,
		isNew: baselineFingerprints.size === 0
			? true
			: !baselineFingerprints.has(issue.fingerprint),
	});
```

with:

```typescript
function applyOutputFilters(
	result: ScanResult,
	options: CliOptions,
	baselineFingerprints: Set<string> | null,
): CliScanResult {
	const filterIssue = (issue: ScanResult["issues"][number]) => {
		if (options.severity && !options.severity.includes(issue.severity)) return false;
		const path = issue.primaryPath ?? issue.relatedPaths[0] ?? "";
		if (options.include.length > 0 && !options.include.some((glob) => matchesGlob(path, glob))) {
			return false;
		}
		if (options.exclude.some((glob) => matchesGlob(path, glob))) return false;
		return true;
	};

	// null means the baseline is not comparable: no isNew annotation is
	// fabricated from an incompatible baseline.
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

- [ ] **Step 5: Replace `readBaselineFingerprints` with `readBaseline`**

In `cli/cli.ts`, replace (lines 466–474):

```typescript
async function readBaselineFingerprints(path: string): Promise<Set<string>> {
	const raw = await readFile(path, "utf8");
	const parsed = JSON.parse(raw) as { issues?: Array<{ fingerprint?: unknown }> };
	return new Set(
		(parsed.issues ?? [])
			.map((issue) => issue.fingerprint)
			.filter((fingerprint): fingerprint is string => typeof fingerprint === "string"),
	);
}
```

with:

```typescript
async function readBaseline(path: string): Promise<BaselineReport> {
	const raw = await readFile(path, "utf8");
	const parsed = JSON.parse(raw) as {
		issues?: Array<{ fingerprint?: unknown }>;
		ignoredIssues?: Array<{ fingerprint?: unknown }>;
		comparison?: unknown;
	};

	const readFingerprints = (
		issues: Array<{ fingerprint?: unknown }> | undefined,
	): string[] =>
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

- [ ] **Step 6: Extend `buildCliComparison` with mode selection**

In `cli/cli.ts`, replace the doc comment and signature (lines 476–489):

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
```

with:

```typescript
/**
 * Builds the additive comparison metadata for one CLI run. Without a
 * baseline the comparison is honestly unavailable (zero counts, never
 * "everything is new"). A current-format baseline that fails
 * resolveBaselineCompatibility is a setup failure: available is false, the
 * reason names the mismatch, and all counts are zero. Legacy baselines are
 * compared fingerprint-only ("legacy"); matched current baselines compare
 * under "profile". Counts always cover the FULL unfiltered result
 * (issues + ignoredIssues), mirroring compareScanResult in
 * src/scanner/result-diff.ts so output filters never inflate
 * resolvedIssues.
 */
function buildCliComparison(
	result: ScanResult,
	baseline: BaselineReport | null,
	scanProfile: string,
	mismatch: BaselineMismatchReason | null,
): CliComparison {
```

Then replace the legacy return branch (lines 527–535):

```typescript
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

with:

```typescript
	if (mismatch) {
		return {
			available: false,
			mode: "profile",
			reason: mismatch,
			newIssues: 0,
			persistingIssues: 0,
			resolvedIssues: 0,
			...metadata,
		};
	}

	return {
		available: true,
		mode: baseline.kind === "current" ? "profile" : "legacy",
		newIssues,
		persistingIssues,
		resolvedIssues,
		...metadata,
	};
}
```

(The mismatch branch sits after the fingerprint counting so the shared
counting code stays untouched; mismatched runs simply discard the counts.
`baseline.kind` is `"legacy"` or `"current"` at that point — `null` returned
earlier and `mismatch` just handled.)

- [ ] **Step 7: Run the focused CLI suites**

```bash
npm test -- src/tests/cli.test.ts src/tests/cli-package.test.ts
```

Expected: PASS — all four new tests and both flipped tests green, and every
other pre-existing CLI test green unedited. If any unrelated pre-existing
test fails, STOP: the change stopped being behavior-compatible for
comparable scans; fix the implementation, never the pinned test.

---

### Task 6: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/cli.test.ts src/tests/result-diff.test.ts
```

Expected: PASS — mismatched baselines cannot create false lifecycle results
and legacy baseline users receive a compatible migration path.

- [ ] **Step 2: Verify the built CLI end to end**

```bash
npm run build
node cli.js --help
```

(`--help` prints usage unchanged with exit 0. Optionally, against any
throwaway vault: `node cli.js /path/to/vault --format json > b.json && node
cli.js /path/to/vault --baseline b.json --fail-on new | jq '.comparison'`
must show `mode: "profile"` with exit `0`; deleting the `comparison` key from
`b.json` and rerunning must show `mode: "legacy"` plus the stderr warning.)

- [ ] **Step 3: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0, zero ESLint warnings, build regenerates usable
`main.js` and `cli.js`, full suite green (coverage thresholds 40/40/50 hold —
`result-diff.ts` and `cli/cli.ts` gain only covered branches).

- [ ] **Step 4: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `cli/cli.ts`, `src/scanner/result-diff.ts`,
`src/tests/cli.test.ts`, and `src/tests/result-diff.test.ts`, plus this
plan/spec pair if committed together. NOT `src/scanner/scanners/*`,
`src/scanner/ScanRunner.ts`, `src/scanner/scan-profile.ts`,
`src/snapshot/*`, `src/report/*`, `src/settings/*`, `src/main.ts`,
`cli/local-vault.ts`, `cli/bin.ts`, `skills/vault-inspector/SKILL.md`,
`README.md`, or `package.json`.

- [ ] **Step 5: Commit and push**

```bash
git add cli/cli.ts src/scanner/result-diff.ts src/tests/cli.test.ts src/tests/result-diff.test.ts
git commit -m "feat: compare compatible CLI scan baselines"
git push -u origin feat/cli-baseline-comparison
```

- [ ] **Step 6: Open the PR** against `main`, titled
  `feat: compare compatible CLI scan baselines`, covering: metadata-aware
  baseline reading (`readBaseline` → `BaselineReport` current/legacy, thrown
  error on malformed `comparison` metadata); shared compatibility gate
  `resolveBaselineCompatibility` exported from `src/scanner/result-diff.ts`
  and used by both `compareScanResult` (semantics identical, pre-existing
  tests unedited) and the CLI (`semantics-changed` before
  `settings-changed`); matched current baselines emit
  `mode: "profile"` with new/persisting/resolved counts; mismatches emit
  `available: false` + `reason`, omit `isNew`, and force exit `2` overriding
  `--fail-on` (including `none`); legacy baselines keep fingerprint-only
  comparison (`issues`-only extraction frozen) plus an always-on stderr
  warning; `--fail-on new`, severity thresholds, exit codes for comparable
  scans, markdown output, and stable automation fields unchanged; documented
  roadmap file-list deviations (`src/scanner/scan-profile.ts` and
  `src/snapshot/scan-snapshot.ts` need no changes). Include the roadmap
  PR-description items: focused tests run, full verification results,
  non-goals, compatibility impact, and remaining boundaries (Task 4.3
  skill/README documentation).

## Self-review checklist (completed during plan writing)

- Roadmap Task 4.2 requirement ↔ implementation mapping: read current baselines with profile and comparison metadata ✓ (Task 5 Step 5 `readBaseline` current branch reading `comparison.scanProfile`/`comparison.comparisonVersion` plus `issues` + `ignoredIssues` fingerprints); legacy baselines fingerprint-only with `mode: "legacy"` + stderr warning ✓ (legacy branch frozen to `issues`, Task 5 Step 3 warning line, pinned by Task 4 Step 3 legacy test asserting both the `has no scan profile metadata` prefix with the resolved path and `legacy mode`); current-format mismatches as setup failures with exit `2` ✓ (Task 5 Step 3 `mismatch ? 2 : getExitCode(...)`, overriding `--fail-on` including `none` — pinned by the semantics test that passes `--fail-on none` and still expects `2`); new/persisting/resolved counts for compatible baselines ✓ (`buildCliComparison` counting loop untouched, `mode: baseline.kind === "current" ? "profile" : "legacy"`, pinned by the two flipped tests); `--fail-on new`/severity thresholds/existing exit-code behavior preserved for comparable scans ✓ (`getExitCode` untouched, `applyOutputFilters` filtering untouched, only `annotate` gains a `null` guard that comparable scans never hit).
- No placeholders: every step quotes complete replacement code anchored to current file lines; every new test is fully written with determined fixture arithmetic (`{keep,drop}` → `{keep,added}` → 1/1/1; `--scanner` change guarantees a different `createScanProfile` hash via `enabledScanners`; `comparisonVersion: 3` exercises the version-first precedence).
- Type/name consistency verified against real code: `buildCliComparison`'s current call site is `cli/cli.ts` line 145 and its signature is `buildCliComparison(result, baseline: Set<string> | null, scanProfile)` — both replaced consistently with the `BaselineReport`/`mismatch` forms, and the mismatch return is typed by the exported `BaselineMismatchReason` union whose members are exactly the `CliComparisonReason` values `settings-changed`/`semantics-changed` reserved in 4.1; `CliIssue.isNew` is optional (`cli/cli.ts` line 431), so returning the bare issue under `null` type-checks; `ComparisonUnavailableReason` (`src/scanner/result-diff.ts` lines 10–13) already includes both mismatch reasons, so `unavailable(mismatch)` type-checks without widening; `resolveBaselineCompatibility` uses only `COMPARISON_VERSION`, already imported in `result-diff.ts` line 3.
- Baseline reading audited: today's fingerprints come from `parsed.issues[].fingerprint` only (`readBaselineFingerprints`, `cli/cli.ts` lines 466–474) — the legacy branch reproduces that expression verbatim so legacy `isNew` is bit-identical; the current branch adds `ignoredIssues` because `createScanSnapshot` (`src/snapshot/scan-snapshot.ts` lines 55–59) records active + ignored findings and `compareScanResult` compares against both, so omitting them would falsely count active↔ignored moves as resolved.
- Setup-failure exit path audited relative to `--fail-on`: exit `2` today is produced only by argument/config errors, reserved `--fix`, and the outer `catch` (`cli/cli.ts` lines 104, 109, 114, 166–170 — including unreadable baselines, which throw inside the `try`). This plan adds two exit-2 producers: the malformed-metadata throw reusing the outer `catch`, and the `mismatch ? 2 : getExitCode(...)` override placed after `getExitCode` so result-based exit codes (`--fail-on new`, severity thresholds) are computed normally for every comparable scan and bypassed only for the setup failure.
- The two flipped pre-existing assertions audited: both Task 4.1 tests write the baseline from `first.stdout` of the current CLI, which emits `comparison` with `scanProfile`/`comparisonVersion` (`toJsonPayload`, `cli/cli.ts` line 427) — so after this task they compare as `kind: "current"` with matching metadata (same `--scanner`, same defaults) and `mode: "profile"` is the correct expectation; `second.stderr).toBe("")` still holds because matched current baselines produce no warning.
- Legacy/malformed distinction audited: detection is keyed on the file's own shape (`comparison === undefined` → legacy), not tool version, so a pre-4.1 report written by any older CLI is legacy; a `comparison` object with wrong types throws rather than downgrading — a file claiming the current format without usable metadata is a broken input, and silently treating it as legacy would re-create the false-lifecycle-results problem the task exists to fix.
- `mode: "profile"` + `available: false` legality audited: 4.1's doc comment ties `reason` presence to `available === false` but never ties `mode: "profile"` to `available: true`; `mode` names the baseline's format, `available`/`reason` name the trust state — documented in the spec's interpretation decisions and in the rewritten `buildCliComparison` doc comment.
- `summary.newIssues` under a mismatch: counted as `isNew !== false` so it equals the active issue count; meaningless but stable — exit `2` plus `comparison.available: false` prevent consumers from acting on it; documented as a deliberate non-change.
- Plugin impact audited: `compareScanResult` refactor swaps two inline guards for one helper call with identical mapping (`comparisonVersion` → `semantics-changed` first, `scanProfile` → `settings-changed`); the entire pre-existing `describe("compareScanResult")` suite (including "rejects changed comparison semantics before checking settings" and "rejects changed detection settings") passes unedited.
- Obsidian lint constraints: `src/scanner/result-diff.ts` uses no Obsidian or Node APIs (the helper is pure arithmetic); `cli/` is outside the `lint:obsidian-warnings` `src/**` scope; no new `obsidian` imports; no `eslint-disable`.
- Precision-suite/CLI impact: precision suite untouched (scanners, `ScanRunner`, fingerprints, `scan-profile.ts`, snapshot shape unchanged); CLI compatibility preserved for every comparable scan — legacy baselines keep 4.1 counts/`isNew` plus one new stderr line (stderr content is not a stable contract and the line is actionable), matched current baselines upgrade `mode` to `"profile"`, and the only intentional behavior change is the mismatch case the roadmap mandates (exit `2`, no `isNew`, zero counts).
