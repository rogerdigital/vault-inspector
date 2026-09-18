# Verified Batch Execution Design (Milestone 2, Task 2.3)

Date: 2026-08-31
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 2, Task 2.3)
Predecessors: `docs/superpowers/specs/2026-08-31-action-impact-policy-design.md` (Task 2.1, merged — `Issue.eligibility` / `Issue.impact` derived by `ScanRunner` via `src/fix/action-policy.ts`) and `docs/superpowers/specs/2026-08-31-fix-impact-preview-design.md` (Task 2.2, merged — `buildConfirmationPlan` / `resolveEligibility` / `isReviewApproved` in `src/fix/confirm-modal.ts`)

## Problem

The batch fix pipeline (`runFixBatch` in `src/fix/fix-runner.ts`) already preflights
each action, skips on changed evidence, continues after an execution failure, and
verifies with one final scan. But three guarantees from the roadmap are not yet
structural:

- **Detection settings are not frozen by the runner.** `main.ts` clones settings
  once into `fixSettings` and closes over it (`scan: () => this.scan(view,
  structuredClone(fixSettings))`, `src/main.ts` lines 209–213), so the guarantee
  lives in one call site. Nothing in `runFixBatch`'s contract enforces that every
  preflight scan and the final verification scan run against the SAME frozen
  detection configuration; any future caller can pass a `scan` closure that reads
  live settings, and a settings change mid-batch would change what the preflight
  and the final scan consider "still present" — producing false `fixed` /
  `still-present` outcomes.
- **The runner executes any issue that carries a decision.** Task 2.2 guarantees
  the modal never returns decisions for `blocked` items, but `runFixBatch` itself
  never reads the policy. A view-level regression, a stale caller, or a hand-built
  `FixDecision[]` executes a `blocked` action today. The last line of defense
  before `dependencies.execute` is currently policy-blind.
- **Execution failures and verification failures render identically.**
  `ActionOutcome` distinguishes them via `phase` (`"execution"` vs
  `"verification"`), but `renderOperationOutcomes` (`src/report/render-outcomes.ts`)
  labels both `Failed` and relegates the distinction to a muted
  `Phase: <phase>` row. The roadmap requires the five outcomes — fixed,
  still-present, skipped, execution-failed, verification-failed — to be visibly
  distinct; today the most consequential distinction (the mutation happened but
  could not be verified) is the least visible.

Task 2.3 makes these guarantees structural: the runner owns the settings freeze,
the action policy is enforced at the execution boundary, and the outcome
rendering names each failure mode.

## Goals

The roadmap's required behavior, restated as where each guarantee is enforced:

- **Freeze a structured clone of detection settings for the whole batch** —
  `runFixBatch` clones once at entry; every preflight scan and the final
  verification scan receive clones of that single frozen snapshot.
- **Run a fresh preflight before every independent action** — already the
  runner's behavior (one `dependencies.scan()` per decision); kept and pinned.
- **Skip actions when fingerprint, target paths, keep candidates, or action
  metadata change** — already enforced by `getFreshFixAction`
  (`src/fix/fix-decisions.ts`); extended to also refuse a fresh issue that the
  policy now evaluates as `blocked`.
- **Continue independent items after one execution failure** — already the
  runner's behavior (per-action `try`/`catch`); kept and pinned.
- **One final verification scan distinguishing fixed / still-present / skipped /
  execution-failed / verification-failed** — the data model already
  distinguishes via `outcome` + `phase`; this task makes the distinction visible
  in the outcome rendering (`Execution failed` / `Verification failed` labels).
- **Keep operation outcomes visible until the user dismisses them** — already
  the behavior (`InspectorView.model.operationOutcomes` persists across renders
  and re-renders after scans; only the Dismiss button clears it); kept, with the
  render contract pinned.
- **Blocked items never execute; review-required items execute only after
  explicit per-item approval** — the 2.1/2.2 integration; placement decided
  below.

## Non-goals (this PR)

- No change to `confirm-modal.ts`, `action-policy.ts`, `fix-executor.ts`, or
  `action-outcomes.ts`'s summary contract — Task 2.2's confirmation model is
  pinned and merged; this task only hardens what happens AFTER the modal
  settles.
- No new outcome kinds: `ActionOutcome` keeps
  `"fixed" | "still-present" | "skipped" | "failed"` with the optional `phase`.
  The execution/verification split is a presentation concern over the existing
  data; adding two new outcome strings would churn the CLI-adjacent summary
  contract for no data gain.
- No scanner, settings, snapshot, fingerprint, `COMPARISON_VERSION`, or CLI
  changes. The CLI never calls the fix pipeline (scan-only by design); nothing
  here moves a stable field.
- No concurrency change: the batch still runs inside `enqueueOperation`'s
  serialized boundary; "one final verification scan" means exactly one scan
  after the per-action preflights, not a parallelized redesign.

## Design

### Where the policy enforcement lives (the 2.1/2.2 integration decision)

Two candidates: the decision state (`buildFixDecisionState`) or a runner guard.
The guard lives in the runner, for three reasons:

1. **`buildFixDecisionState` is shared with the confirmation plan.** Task 2.2's
   `buildConfirmationPlan` filters to `actionable` (eligible + approved
   review-required) BEFORE delegating to `buildFixDecisionState`, and pins
   `complete` semantics over that pre-filtered set. Re-filtering eligibility
   inside the state builder would double-filter and change `complete` for
   inputs 2.2's tests pin (e.g. always-ask eligible groups).
2. **The approval state cannot travel with the decision.** Review approval is a
   per-modal-interaction fact (`approvedReviews` fingerprints inside
   `ConfirmFixModal`); the settled `FixDecision[]` is the modal's entire output.
   Enriching `FixDecision` with an approval bit would duplicate information the
   modal already encoded by omission (unapproved items simply get NO decision),
   and would require every future caller to construct it correctly. Omission is
   already the enforcement: an unapproved review-required item has no decision,
   and the runner skips it with `No confirmed fix decision was available.`
3. **The runner is the last pure gate before mutation.** It sees both the
   requested issue AND the fresh (preflight) issue. Blocking must hold on both:
   the requested issue must not have been blocked at confirm time, and the
   fresh issue must not have been re-evaluated as blocked between confirm and
   execute. Only the runner sees both.

Concretely, `src/fix/fix-decisions.ts` (pure, Obsidian-free) gains:

```ts
export function isBlockedFromExecution(issue: Issue): boolean {
	return issue.fixAction !== undefined && issue.eligibility === "blocked";
}
```

A missing `eligibility` field (hand-built issue) is NOT blocked — the 2.2
conservative default treats missing fields as `review-required`, which routes
through the no-decision skip above; blocking on a missing field would break
every legitimate hand-built test fixture and any future verified producer that
pre-dates annotation. `isBlockedFromExecution` checks exactly the one tier that
must never execute.

The runner applies it twice per issue:

- **Requested-side guard**, before the decision lookup: an issue that is
  `blocked` at request time gets
  `skipped` / `phase: "preflight"` /
  `"The fix is blocked by the action policy."` — an explicit, visible outcome
  rather than the generic no-decision message, so a caller regression is
  diagnosable from the outcome panel.
- **Fresh-side guard**, inside the preflight: if the fresh issue is now
  `isBlockedFromExecution`, the action is skipped with
  `"The finding was re-evaluated as blocked before execution."` — same skip
  machinery as changed evidence, distinct message because the cause differs
  (policy re-evaluation, not stale evidence).

Review-required enforcement stays where 2.2 put it (the confirmation plan
filters to approved items; unapproved items get no decision) and is enforced
transitively at the runner via the existing no-decision skip. Nothing about the
modal changes.

### Settings freeze inside the runner

`FixRunnerDependencies` changes shape so the freeze is the runner's contract,
not a call-site convention:

```ts
export type FixRunnerDependencies = {
	/** Read live plugin settings once; the batch clones and freezes the value. */
	settings: () => InspectorSettings;
	/** Every scan in the batch (preflights + final verification) receives a clone of the frozen settings. */
	scan: (settings: InspectorSettings) => Promise<ScanResult | null>;
	execute: (action: FixAction) => Promise<number>;
};
```

`runFixBatch` starts with:

```ts
const frozenSettings = structuredClone(dependencies.settings());
```

and every scan call — one preflight per independent action plus the one final
verification — passes `structuredClone(frozenSettings)` (a per-call clone so a
consumer that mutates its argument cannot corrupt the frozen base). A settings
change made while the batch runs therefore cannot change what any preflight or
the final scan detects: fixed / still-present verdicts are comparable because
every scan in the batch ran under one configuration.

`src/main.ts` adapts (documented deviation from the roadmap file list — it is
the only call site): it keeps its own `fixSettings = structuredClone(this.settings)`
for `createScanProfile` (the acceptance profile must match the batch's frozen
settings), and passes
`{ settings: () => fixSettings, scan: (settings) => this.scan(view, settings), execute: ... }`.
Profile and every batch scan now provably derive from one snapshot.

### Fresh-side guard in `getFreshFixAction`

`src/fix/fix-decisions.ts`: `getFreshFixAction` additionally returns `null`
when `isBlockedFromExecution(freshIssue)`. The explicit fresh-blocked message
above is produced by the runner before this call, so the `getFreshFixAction`
refusal is the backstop for callers that use it directly; the fingerprint,
candidate-set, and metadata comparisons are unchanged.

### Outcome rendering: five visibly distinct outcomes

`src/report/render-outcomes.ts` keeps the summary contract
(`summarizeOperationOutcomes` counts both failure modes under `Failed` — the
batch-level "how many went wrong" number) but replaces the per-item label for
failures with a phase-aware one:

```ts
export function describeOutcomeLabel(outcome: OperationOutcome): string {
	if (outcome.outcome === "failed") {
		if (outcome.phase === "verification") return "Verification failed";
		if (outcome.phase === "execution") return "Execution failed";
		return "Failed";
	}
	return OUTCOME_LABELS[outcome.outcome];
}
```

The per-item label becomes `describeOutcomeLabel(outcome)`; the
`Phase: <phase>` row is rendered only for non-failed outcomes that carry a
phase (i.e. `Skipped · Phase: preflight`) — for failures the label now carries
the distinction, so the row would be redundant. `Verification failed` is the
label that matters most: the mutation happened and could NOT be proven
effective, which is exactly the state a user must not misread as `Fixed`.

### Already-satisfied requirements (kept and pinned, not rebuilt)

- **Fresh preflight per action**: one `dependencies.scan()` per decision, in
  input order, inside the loop — unchanged.
- **Skip on fingerprint / target-path / keep-candidate / metadata change**:
  `getFreshFixAction` compares fingerprint identity, `kind`, `label`,
  `description`, `linkText`, ordered `targetPaths`, `selection.requiresReview`,
  and the sorted `candidatePaths` set — unchanged.
- **Continue after one execution failure**: per-action `try`/`catch`; a failure
  records its outcome and the loop proceeds — unchanged.
- **One final verification scan**: a single `dependencies.scan()` after the
  loop, under the same frozen settings; remaining-fingerprint lookup covers
  `issues` and `ignoredIssues` — unchanged.
- **Outcomes visible until dismissed**: `renderOperationOutcomes` renders from
  `model.operationOutcomes`, which survives re-renders and post-batch scans
  (`acceptScanResult` re-renders the view without touching the outcomes); the
  Dismiss button is the only path that clears it
  (`() => this.setOperationOutcomes([])`) — unchanged, and the render contract
  is pinned by tests.

## Test strategy

- `src/tests/fix-decisions.test.ts` (extended) pins:
  - `isBlockedFromExecution`: true for a fix-bearing `eligibility: "blocked"`
    issue; false for `eligible`, `review-required`, missing-field, and
    fix-less issues.
  - `getFreshFixAction` refuses when the fresh issue is `blocked` (requested
    unchanged, fresh annotated `eligibility: "blocked"` → `null`).
- `src/tests/fix-runner.test.ts` (extended, and existing dependency literals
  updated to the new shape) pins:
  - the frozen settings: every `scan` call receives a deep-equal clone of the
    snapshot taken at entry, even when the object behind `settings()` mutates
    mid-batch;
  - a requested `blocked` issue never executes — skipped with
    `The fix is blocked by the action policy.`, `execute` not called;
  - a fresh re-evaluated-`blocked` issue never executes — skipped with
    `The finding was re-evaluated as blocked before execution.`;
  - execution failure and verification failure coexist in one batch with their
    distinct phases (already pinned; kept).
- `src/tests/render-outcomes.test.ts` (extended) pins:
  - `outcome: "failed", phase: "execution"` renders the label
    `Execution failed` and no `Phase: execution` row;
  - `outcome: "failed", phase: "verification"` renders `Verification failed`;
  - the summary still reports both failure modes under `Failed <n>`;
  - `Skipped` keeps its label plus `Phase: preflight`;
  - the dismiss button remains the only clearing path (existing test kept).

## Verification strategy

```bash
npm test -- src/tests/fix-decisions.test.ts src/tests/fix-runner.test.ts src/tests/render-outcomes.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: no stale or policy-blocked action executes; every attempted change
has a visible, distinct final status; the full suite confirms the call-site
change in `main.ts` compiles and the confirmation-model suites from 2.2 pass
unmodified.

## Precision-suite and CLI impact

None. The fix pipeline is plugin-side; the CLI is scan-only and never calls
`runFixBatch`. No scanner, `ScanRunner`, snapshot, fingerprint, or
`COMPARISON_VERSION` change. `ActionOutcome`'s shape is unchanged, so the
outcome summary consumed by `main.ts`'s ignore/restore flows is untouched.

## Risks

- **`InspectorSettings` import into `fix-runner.ts`.** Type-only import from
  `src/settings/settings.ts` (a pure type module, no Obsidian dependency);
  `structuredClone` is the platform global already used in `main.ts`. No
  Obsidian API enters the runner.
- **Existing `fix-runner` tests change shape.** The dependency literal gains
  `settings: () => DEFAULT_SETTINGS` and `scan` mocks gain an ignored argument.
  This is the deliberate contract change; the plan quotes the exact replacement
  per test.
- **Blocked skip produces a NEW outcome message** where the modal already
  prevents the case in practice. Intentional defense-in-depth: the outcome
  makes a future caller regression visible in the panel instead of silent.
- **Freeze does not protect against direct vault mutation mid-batch.** It
  freezes detection configuration, not the vault; the per-action preflight and
  fingerprint comparison remain the vault-freshness guarantees. A settings
  freeze cannot and does not try to substitute for them.
