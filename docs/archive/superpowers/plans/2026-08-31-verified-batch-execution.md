# Verified Batch Execution Implementation Plan (Milestone 2, Task 2.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Task 2.3's batch execution guarantees structural in the fix pipeline. `runFixBatch` (`src/fix/fix-runner.ts`) clones and freezes detection settings once at entry and passes clones of that snapshot to every preflight scan and the one final verification scan (new `FixRunnerDependencies` shape: `settings: () => InspectorSettings` + `scan(settings)`). The action policy is enforced at the execution boundary: an issue that is `eligibility === "blocked"` at request time, or that the fresh preflight re-evaluates as blocked, is skipped with an explicit outcome and never reaches `dependencies.execute` — via a pure predicate `isBlockedFromExecution` exported from `src/fix/fix-decisions.ts`, which also backstops `getFreshFixAction`. Review-required approval stays enforced by the 2.2 confirmation plan (unapproved items get no decision; the runner's existing no-decision skip covers them). `src/report/render-outcomes.ts` gains `describeOutcomeLabel` so execution failures render as `Execution failed` and verification failures as `Verification failed` (summary counts unchanged; `Skipped · Phase: preflight` kept). `src/main.ts` adapts the single call site (documented deviation). No changes to `confirm-modal.ts`, `action-policy.ts`, `fix-executor.ts`, `action-outcomes.ts`, scanners, settings shape, snapshots, fingerprints, or CLI.

**Architecture:** The freeze and both blocked guards live in `fix-runner.ts` because it is the last pure gate before mutation and the only component that sees both the requested and the fresh issue; the predicate `isBlockedFromExecution` lives in `fix-decisions.ts` (pure, Obsidian-free, already imported by the runner) because `buildFixDecisionState` is shared with the 2.2 confirmation plan whose filtering and `complete` semantics must not change. `ActionOutcome` keeps its shape (`failed` + `phase`) — the execution/verification split is presentation only, in `describeOutcomeLabel`. `main.ts` keeps its own `fixSettings` clone for `createScanProfile` and hands the same snapshot to the runner so the acceptance profile and every batch scan derive from one configuration.

**Tech Stack:** TypeScript, Vitest, DOM-fake element fixtures (`src/tests/render-outcomes.test.ts` pattern)

Design doc: `docs/superpowers/specs/2026-08-31-verified-batch-execution-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 2, Task 2.3)

---

## Ground rules

- Branch: `feat/verified-batch-execution`, cut from latest `main`.
- One commit: `feat: enforce action policy in verified batches`.
- Blocked items never execute under any input; the guards must fail closed (skip with a visible outcome), never throw.
- Review-required enforcement is NOT re-implemented here: the 2.2 confirmation plan already omits decisions for unapproved items, and the runner's existing `No confirmed fix decision was available.` skip covers them. Do not add approval state to `FixDecision`.
- Every scan in the batch must run against clones of ONE structured-clone snapshot taken at `runFixBatch` entry. No scan may read live settings.
- `ActionOutcome`'s type, `summarizeOperationOutcomes`, and the outcome summary contract are unchanged; the execution/verification distinction is rendering only.
- Do not modify `src/fix/confirm-modal.ts`, `src/fix/action-policy.ts`, `src/fix/fix-executor.ts`, `src/fix/action-outcomes.ts`, `src/scanner/*`, `src/settings/settings.ts`, `src/snapshot/*`, `src/report/*` (except `render-outcomes.ts`), or `cli/*`.
- Deviation from the roadmap file list: `src/main.ts` is modified (the only `runFixBatch` call site must adopt the new dependency shape); `src/fix/action-outcomes.ts` is NOT modified.
- UI strings are sentence-case (Obsidian review convention).
- Never `eslint-disable` any `obsidianmd/*` rule.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/verified-batch-execution
```

---

### Task 2: Write the failing tests first (TDD)

**Files:**
- Modify: `src/tests/fix-decisions.test.ts`
- Modify: `src/tests/fix-runner.test.ts`
- Modify: `src/tests/render-outcomes.test.ts`

- [ ] **Step 1: Extend `src/tests/fix-decisions.test.ts`**

Update the import at the top (lines 1–7) to:

```typescript
import {
	buildFixDecisionState,
	getFreshFixAction,
	isBlockedFromExecution,
	resolveDecisionAction,
} from "../fix/fix-decisions";
```

Append at the end of the file (after the closing `});` of the last describe block):

```typescript
describe("action policy enforcement in fix decisions", () => {
	it("identifies only explicitly blocked fix-bearing issues as blocked from execution", () => {
		expect(
			isBlockedFromExecution({ ...makePlainIssue(), eligibility: "blocked" }),
		).toBe(true);
		expect(
			isBlockedFromExecution({ ...makePlainIssue(), eligibility: "eligible" }),
		).toBe(false);
		expect(
			isBlockedFromExecution({
				...makePlainIssue(),
				eligibility: "review-required",
			}),
		).toBe(false);
		// A missing eligibility field degrades to review-required, never blocked.
		expect(isBlockedFromExecution(makePlainIssue())).toBe(false);
		expect(
			isBlockedFromExecution({
				...makePlainIssue(),
				fixAction: undefined,
				eligibility: "blocked",
			}),
		).toBe(false);
	});

	it("refuses a fresh issue that the policy re-evaluated as blocked", () => {
		const requested = makePlainIssue();
		const fresh = { ...makePlainIssue(), eligibility: "blocked" };
		expect(
			getFreshFixAction(requested, fresh, {
				fingerprint: requested.fingerprint,
			}),
		).toBeNull();
	});
});
```

- [ ] **Step 2: Update the existing `src/tests/fix-runner.test.ts` dependency literals**

Update the imports at the top (lines 1–3) to:

```typescript
import { describe, expect, it, vi } from "vitest";
import type { FixAction, Issue, ScanResult } from "../scanner/Issue";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { runFixBatch } from "../fix/fix-runner";
```

Then apply one mechanical replacement across the whole file: every occurrence of
the dependency literal opening `{ scan,` becomes
`{ settings: () => DEFAULT_SETTINGS, scan,` (10 occurrences — every
`runFixBatch` call in the file). Example, before:

```typescript
		{ scan, execute: vi.fn().mockResolvedValue(2) },
```

after:

```typescript
		{ settings: () => DEFAULT_SETTINGS, scan, execute: vi.fn().mockResolvedValue(2) },
```

The `scan` mocks keep working unchanged: they ignore the settings argument the
runner now passes.

- [ ] **Step 3: Append the new guarantees to `src/tests/fix-runner.test.ts`**

Append inside the existing `describe("runFixBatch", ...)` block, after the
"returns the exact final result after one preflight per decision and one
verification" test (before the block's closing `});`):

```typescript
	it("freezes detection settings for the whole batch", async () => {
		const first = issue("first");
		const second = issue("second");
		const live = { ...DEFAULT_SETTINGS };
		const scan = vi.fn().mockImplementation(async () => {
			live.duplicateKeepMode = "always-ask";
			return result([first, second]);
		});

		const batch = await runFixBatch(
			[first, second],
			[first, second].map(({ fingerprint }) => ({ fingerprint })),
			{ settings: () => live, scan, execute: vi.fn().mockResolvedValue(1) },
		);

		expect(scan).toHaveBeenCalledTimes(3);
		for (const [received] of scan.mock.calls) {
			expect(received).not.toBe(live);
			expect(received.duplicateKeepMode).toBe(DEFAULT_SETTINGS.duplicateKeepMode);
		}
		expect(batch.outcomes.every((outcome) => outcome.outcome === "still-present")).toBe(true);
	});

	it("never executes an issue that was blocked at request time", async () => {
		const blocked = { ...issue("blocked"), eligibility: "blocked" };
		const scan = vi.fn();
		const execute = vi.fn();

		const batch = await runFixBatch(
			[blocked],
			[{ fingerprint: "blocked" }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute },
		);

		expect(batch.outcomes).toEqual([{
			fingerprint: "blocked",
			outcome: "skipped",
			phase: "preflight",
			message: "The fix is blocked by the action policy.",
			affectedPaths: ["blocked.md"],
		}]);
		expect(scan).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
	});

	it("skips when the preflight re-evaluates the finding as blocked", async () => {
		const requested = issue("reblocked");
		const fresh = { ...issue("reblocked"), eligibility: "blocked" };
		const scan = vi.fn().mockResolvedValue(result([fresh]));
		const execute = vi.fn();

		const batch = await runFixBatch(
			[requested],
			[{ fingerprint: "reblocked" }],
			{ settings: () => DEFAULT_SETTINGS, scan, execute },
		);

		expect(batch.outcomes).toEqual([{
			fingerprint: "reblocked",
			outcome: "skipped",
			phase: "preflight",
			message: "The finding was re-evaluated as blocked before execution.",
			affectedPaths: ["reblocked.md"],
		}]);
		expect(execute).not.toHaveBeenCalled();
	});
```

- [ ] **Step 4: Extend `src/tests/render-outcomes.test.ts`**

Append inside the existing `describe("renderOperationOutcomes", ...)` block,
after the "uses a native button and invokes the dismiss callback" test:

```typescript
	it("labels execution and verification failures distinctly", () => {
		const container = new FakeElement();

		renderOperationOutcomes(
			container as unknown as HTMLElement,
			[
				{
					fingerprint: "exec",
					outcome: "failed",
					phase: "execution",
					message: "Permission denied",
					affectedPaths: ["exec.md"],
				},
				{
					fingerprint: "verify",
					outcome: "failed",
					phase: "verification",
					message: "The final verification scan did not complete.",
					affectedPaths: ["verify.md"],
				},
			],
			vi.fn(),
		);

		const text = flattenedText(container);
		expect(text).toContain("Execution failed");
		expect(text).toContain("Verification failed");
		expect(text).not.toContain("Phase: execution");
		expect(text).not.toContain("Phase: verification");
		const summary = findByClass(container, "vi-outcomes-summary")[0];
		expect(summary.text).toContain("Failed 2");
	});

	it("keeps the phase row for skipped outcomes", () => {
		const container = new FakeElement();

		renderOperationOutcomes(
			container as unknown as HTMLElement,
			[{
				fingerprint: "skipped",
				outcome: "skipped",
				phase: "preflight",
				message: "The finding or fix evidence changed before execution.",
				affectedPaths: ["skipped.md"],
			}],
			vi.fn(),
		);

		expect(flattenedText(container)).toContain("Skipped");
		expect(flattenedText(container)).toContain("Phase: preflight");
	});
```

- [ ] **Step 5: Run and confirm failure**

```bash
npm test -- src/tests/fix-decisions.test.ts src/tests/fix-runner.test.ts src/tests/render-outcomes.test.ts
```

Expected: FAIL — `isBlockedFromExecution` is not exported; `runFixBatch` rejects
the `settings` dependency (and passes no settings argument to `scan`, so the
freeze test's `mock.calls` assertions fail); the failure labels render
`Failed` with `Phase: execution`/`Phase: verification` rows instead of
`Execution failed`/`Verification failed`.

---

### Task 3: Add the blocked predicate and fresh-side guard in `src/fix/fix-decisions.ts`

**Files:**
- Modify: `src/fix/fix-decisions.ts`

- [ ] **Step 1: Add `isBlockedFromExecution` after the `FixDecisionState` type**

Insert after the closing `};` of `export type FixDecisionState = { ... }`
(lines 9–12), before `export function buildFixDecisionState`:

```typescript
/**
 * Whether an issue's fix must never execute. Only the explicit `blocked`
 * tier qualifies: a missing eligibility field degrades to review-required
 * (fixable through an explicit per-item decision), and review-required
 * items are gated by the confirmation plan's decision omission, not here.
 */
export function isBlockedFromExecution(issue: Issue): boolean {
	return issue.fixAction !== undefined && issue.eligibility === "blocked";
}
```

- [ ] **Step 2: Refuse a blocked fresh issue in `getFreshFixAction`**

In `getFreshFixAction` (lines 71–105), extend the early null guard. Replace:

```typescript
	const requested = requestedIssue.fixAction;
	const fresh = freshIssue?.fixAction;
	if (
		decision.fingerprint !== requestedIssue.fingerprint
		|| freshIssue?.fingerprint !== requestedIssue.fingerprint
		|| !requested
		|| !fresh
	) {
		return null;
	}
```

with:

```typescript
	const requested = requestedIssue.fixAction;
	const fresh = freshIssue?.fixAction;
	if (
		decision.fingerprint !== requestedIssue.fingerprint
		|| freshIssue?.fingerprint !== requestedIssue.fingerprint
		|| !requested
		|| !fresh
		|| isBlockedFromExecution(freshIssue)
	) {
		return null;
	}
```

- [ ] **Step 3: Run the decision tests**

```bash
npm test -- src/tests/fix-decisions.test.ts
```

Expected: PASS — existing 9 tests plus the 2 new ones.

---

### Task 4: Freeze settings and enforce the policy in `src/fix/fix-runner.ts`

**Files:**
- Modify: `src/fix/fix-runner.ts`

- [ ] **Step 1: Replace the whole file with the frozen-batch version**

Replace the entire contents of `src/fix/fix-runner.ts` with:

```typescript
import type { FixAction, Issue, ScanResult } from "../scanner/Issue";
import type { InspectorSettings } from "../settings/settings";
import type { ActionOutcome } from "./action-outcomes";
import {
	getFreshFixAction,
	isBlockedFromExecution,
	type FixDecision,
} from "./fix-decisions";

export type FixRunnerDependencies = {
	/** Read live settings once; the batch clones and freezes the value for every scan. */
	settings: () => InspectorSettings;
	/** Receives a clone of the frozen settings on every call (preflights + final verification). */
	scan: (settings: InspectorSettings) => Promise<ScanResult | null>;
	execute: (action: FixAction) => Promise<number>;
};

export type FixBatchResult = {
	outcomes: ActionOutcome[];
	verificationResult: ScanResult | null;
};

type PendingAction = {
	index: number;
	fingerprint: string;
	affectedPaths: string[];
	affectedCount: number;
};

export async function runFixBatch(
	issues: Issue[],
	decisions: FixDecision[],
	dependencies: FixRunnerDependencies,
): Promise<FixBatchResult> {
	const frozenSettings = structuredClone(dependencies.settings());
	const scanOnce = () => dependencies.scan(structuredClone(frozenSettings));

	const decisionsByFingerprint = new Map(
		decisions.map((decision) => [decision.fingerprint, decision]),
	);
	const outcomes: Array<ActionOutcome | null> = issues.map(() => null);
	const pending: PendingAction[] = [];

	for (const [index, issue] of issues.entries()) {
		if (isBlockedFromExecution(issue)) {
			outcomes[index] = skipped(
				issue,
				"The fix is blocked by the action policy.",
			);
			continue;
		}

		const decision = decisionsByFingerprint.get(issue.fingerprint);
		if (!decision) {
			outcomes[index] = skipped(
				issue,
				"No confirmed fix decision was available.",
			);
			continue;
		}

		const freshResult = await scanOnce();
		const freshIssue = freshResult
			? [...freshResult.issues, ...freshResult.ignoredIssues].find(
				(candidate) => candidate.fingerprint === issue.fingerprint,
			)
			: undefined;
		if (freshIssue && isBlockedFromExecution(freshIssue)) {
			outcomes[index] = skipped(
				issue,
				"The finding was re-evaluated as blocked before execution.",
			);
			continue;
		}
		const freshAction = getFreshFixAction(issue, freshIssue, decision);
		if (!freshAction) {
			outcomes[index] = skipped(
				issue,
				freshResult
					? "The finding or fix evidence changed before execution."
					: "The preflight scan did not complete.",
			);
			continue;
		}

		try {
			pending.push({
				index,
				fingerprint: issue.fingerprint,
				affectedPaths: [...freshAction.targetPaths],
				affectedCount: await dependencies.execute(freshAction),
			});
		} catch (error) {
			outcomes[index] = {
				fingerprint: issue.fingerprint,
				outcome: "failed",
				phase: "execution",
				message: error instanceof Error ? error.message : String(error),
				affectedPaths: [...freshAction.targetPaths],
			};
		}
	}

	const verificationResult = await scanOnce();
	if (!verificationResult) {
		for (const action of pending) {
			outcomes[action.index] = {
				fingerprint: action.fingerprint,
				outcome: "failed",
				phase: "verification",
				message: "The final verification scan did not complete.",
				affectedPaths: action.affectedPaths,
			};
		}
	} else {
		const remaining = new Set([
			...verificationResult.issues,
			...verificationResult.ignoredIssues,
		].map((issue) => issue.fingerprint));
		for (const action of pending) {
			const stillPresent = remaining.has(action.fingerprint);
			outcomes[action.index] = {
				fingerprint: action.fingerprint,
				outcome: stillPresent ? "still-present" : "fixed",
				message: stillPresent
					? `The finding remains after ${action.affectedCount} change(s).`
					: `Verified after ${action.affectedCount} change(s).`,
				affectedPaths: action.affectedPaths,
			};
		}
	}

	return {
		outcomes: outcomes.filter(
			(outcome): outcome is ActionOutcome => outcome !== null,
		),
		verificationResult,
	};
}

function skipped(issue: Issue, message: string): ActionOutcome {
	return {
		fingerprint: issue.fingerprint,
		outcome: "skipped",
		phase: "preflight",
		message,
		affectedPaths: [...(issue.fixAction?.targetPaths ?? [])],
	};
}
```

What changed behaviorally: the dependency shape (`settings` + parameterized
`scan`), the one-time `structuredClone` freeze with a `scanOnce` wrapper, the
requested-side blocked guard before the decision lookup, and the fresh-side
blocked guard before `getFreshFixAction`. The per-action preflight ordering,
continue-on-failure, one final verification scan, and outcome shapes are
unchanged.

- [ ] **Step 2: Run the runner tests**

```bash
npm test -- src/tests/fix-runner.test.ts
```

Expected: PASS — the 10 existing tests (now on the new dependency shape) plus
the 3 new ones.

---

### Task 5: Distinct failure labels in `src/report/render-outcomes.ts`

**Files:**
- Modify: `src/report/render-outcomes.ts`

- [ ] **Step 1: Add `describeOutcomeLabel` after the `OUTCOME_LABELS` map**

Insert after the `OUTCOME_LABELS` declaration (lines 6–14), before
`export function renderOperationOutcomes`:

```typescript
/**
 * Per-item outcome label. Failures carry their phase in the label because
 * "the mutation happened but could not be verified" must not read as a
 * generic failure; skipped items keep their phase in the details row.
 */
export function describeOutcomeLabel(outcome: OperationOutcome): string {
	if (outcome.outcome === "failed") {
		if (outcome.phase === "verification") return "Verification failed";
		if (outcome.phase === "execution") return "Execution failed";
	}
	return OUTCOME_LABELS[outcome.outcome];
}
```

- [ ] **Step 2: Use it for the item label and scope the phase row**

In the per-item loop, replace:

```typescript
		item.createSpan({
			cls: `vi-outcome-label vi-outcome-${outcome.outcome}`,
			text: OUTCOME_LABELS[outcome.outcome],
		});
```

with:

```typescript
		item.createSpan({
			cls: `vi-outcome-label vi-outcome-${outcome.outcome}`,
			text: describeOutcomeLabel(outcome),
		});
```

and replace:

```typescript
		if ("phase" in outcome && outcome.phase) {
```

with:

```typescript
		if ("phase" in outcome && outcome.phase && outcome.outcome !== "failed") {
```

- [ ] **Step 3: Run the outcome rendering tests**

```bash
npm test -- src/tests/render-outcomes.test.ts
```

Expected: PASS — the 3 existing tests plus the 2 new ones. (The first existing
test still passes: `Phase: preflight` survives via the skipped item, and the
execution-failed item's label becomes `Execution failed` while its message and
the `Failed 1` summary are unchanged.)

---

### Task 6: Adapt the call site in `src/main.ts`

**Files:**
- Modify: `src/main.ts` (documented deviation from the roadmap file list — the only `runFixBatch` call site must adopt the new dependency shape)

- [ ] **Step 1: Hand the frozen snapshot to the runner**

In the `onFixAllIssues` callback, replace (lines 209–214):

```typescript
				const fixSettings = structuredClone(this.settings);
				const scanProfile = await createScanProfile(fixSettings);
				const batch = await runFixBatch(issues, decisions, {
					scan: () => this.scan(view, structuredClone(fixSettings)),
					execute: (action) => executeFixAction(this.app, action),
				});
```

with:

```typescript
				const fixSettings = structuredClone(this.settings);
				const scanProfile = await createScanProfile(fixSettings);
				const batch = await runFixBatch(issues, decisions, {
					settings: () => fixSettings,
					scan: (batchSettings) => this.scan(view, batchSettings),
					execute: (action) => executeFixAction(this.app, action),
				});
```

The acceptance profile and every batch scan now provably derive from the same
snapshot; the runner owns the per-call clones.

- [ ] **Step 2: Run the main-suite tests**

```bash
npm test -- src/tests/main.test.ts src/tests/confirm-modal.test.ts
```

Expected: PASS — `main.ts` compiles against the new dependency shape; the 2.2
confirmation-model suites pass unmodified (nothing in the modal changed).

---

### Task 7: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/fix-decisions.test.ts src/tests/fix-runner.test.ts src/tests/render-outcomes.test.ts
```

Expected: PASS — no stale or policy-blocked action executes, and every
attempted change has a visible final status.

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

Expected: only `src/fix/fix-decisions.ts`, `src/fix/fix-runner.ts`,
`src/report/render-outcomes.ts`, `src/main.ts`,
`src/tests/fix-decisions.test.ts`, `src/tests/fix-runner.test.ts`, and
`src/tests/render-outcomes.test.ts`. NOT `src/fix/confirm-modal.ts`,
`src/fix/action-policy.ts`, `src/fix/fix-executor.ts`,
`src/fix/action-outcomes.ts`, any scanner, `src/settings/settings.ts`,
`src/snapshot/*`, `styles.css`, or `cli/*`.

- [ ] **Step 4: Commit and push**

```bash
git add src/fix/fix-decisions.ts src/fix/fix-runner.ts src/report/render-outcomes.ts src/main.ts src/tests/fix-decisions.test.ts src/tests/fix-runner.test.ts src/tests/render-outcomes.test.ts
git commit -m "feat: enforce action policy in verified batches"
git push -u origin feat/verified-batch-execution
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `feat: enforce action policy in verified batches`, covering: settings frozen
  via one `structuredClone` at `runFixBatch` entry with clones passed to every
  preflight and the final verification scan (new `settings`/`scan(settings)`
  dependency shape; `main.ts` call-site adaptation documented as a roadmap
  file-list deviation); blocked issues never execute (requested-side guard
  before the decision lookup + fresh-side guard via `isBlockedFromExecution`,
  pure predicate exported from `fix-decisions.ts` and backstopping
  `getFreshFixAction`); review-required approval stays enforced by the 2.2
  confirmation plan through decision omission; execution vs verification
  failures render as distinct labels (`describeOutcomeLabel`) with summary
  counts unchanged; outcomes remain visible until dismissed (existing
  behavior, now pinned); no CLI, scanner, settings-shape, snapshot, or
  fingerprint changes (the CLI never calls the fix pipeline).

## Self-review checklist (completed during plan writing)

- Roadmap Task 2.3 checkbox ↔ implementation mapping: freeze settings ✓ (Task 4 `structuredClone` at entry + `scanOnce` wrapper; Task 6 call-site; pinned by the freeze test that mutates `live.duplicateKeepMode` mid-batch); fresh preflight before every independent action ✓ (existing per-decision `scanOnce()` loop, kept); skip on fingerprint/target-paths/keep-candidates/metadata change ✓ (existing `getFreshFixAction` comparisons — fingerprint identity, `kind`, `label`, `description`, `linkText`, ordered `targetPaths`, `requiresReview`, sorted `candidatePaths` — unchanged, plus the new blocked refusal); continue after one execution failure ✓ (existing per-action `try`/`catch`, pinned by the existing "preserves an execution error and continues" test); one final verification scan with five distinct outcomes ✓ (existing single final `scanOnce()`; `describeOutcomeLabel` makes execution-failed and verification-failed visibly distinct — Task 5); outcomes visible until dismissed ✓ (existing `model.operationOutcomes` + Dismiss-only clearing; render contract pinned by the existing dismiss test and the kept `Phase: preflight` test).
- 2.1/2.2 integration decision documented and justified: enforcement lives in the runner guard (requested + fresh) backed by `isBlockedFromExecution` in `fix-decisions.ts`; NOT in `buildFixDecisionState`, because 2.2's `buildConfirmationPlan` pre-filters to actionable and pins `complete` semantics over that set, and because approval state (`approvedReviews`) cannot travel with the settled `FixDecision[]` without duplicating what the modal already encodes by omission. `confirm-modal.ts` is not modified.
- Roadmap focused-verification command reproduced in Task 7 Step 1 with the roadmap's expected outcome.
- Deviations documented: `src/main.ts` modified (call-site must adopt the new dependency shape); `src/fix/action-outcomes.ts` NOT modified (outcome type and summary contract intentionally unchanged — the execution/verification split is presentation only).
- `src/report/render-outcomes.ts` already exists (created in the v0.6 fix-pipeline work; the roadmap file list is correct, not a creation).
- No placeholders: Tasks 3, 4, 5, 6 quote exact current code before replacement (verified against `src/fix/fix-decisions.ts` lines 9–12/71–105, `src/fix/fix-runner.ts` in full, `src/report/render-outcomes.ts` lines 6–14/55–65, `src/main.ts` lines 209–214); Task 2's test additions are complete file-ready code; the fix-runner test-shape update is a single mechanical replacement quoted with an exact before/after example and its occurrence count (10).
- Type/name consistency verified: `InspectorSettings` / `DEFAULT_SETTINGS` match `src/settings/settings.ts` (with `duplicateKeepMode`); `Issue.eligibility?: FixEligibility` with `"blocked"` matches `src/scanner/Issue.ts`; `ActionOutcome` fields (`fingerprint`, `outcome`, `phase`, `message`, `affectedPaths`) match `src/fix/action-outcomes.ts`; `OperationOutcome` is the discriminated union `ActionOutcome | DispositionOutcome`, so `"phase" in outcome` narrowing and `OUTCOME_LABELS[outcome.outcome]` keep typing; the `issue()`/`result()` fixtures match the existing `src/tests/fix-runner.test.ts` helpers; `makePlainIssue` matches `src/tests/fix-decisions.test.ts`; `describeOutcomeLabel`'s failed-without-phase case falls through to `OUTCOME_LABELS.failed`.
- obsidianmd lint constraints: `structuredClone` is the platform global already used in `main.ts` (not an Obsidian API); the `InspectorSettings` import is type-only; all new UI strings sentence-case ("Execution failed", "Verification failed", the two skip messages); no `innerHTML`, no `eslint-disable`.
- Precision-suite/CLI impact: none — `cli/` never imports the fix pipeline (scan-only by design); no scanner, `ScanRunner`, snapshot, fingerprint, or `COMPARISON_VERSION` change; the full-suite gate in Task 7 Step 2 is the safety net.
