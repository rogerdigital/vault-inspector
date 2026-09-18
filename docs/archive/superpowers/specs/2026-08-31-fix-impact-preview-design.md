# Fix Impact Preview Design (Milestone 2, Task 2.2)

Date: 2026-08-31
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 2, Task 2.2)
Predecessor: `docs/superpowers/specs/2026-08-31-action-impact-policy-design.md` (Task 2.1, merged — `Issue.eligibility` / `Issue.impact` are derived by `ScanRunner` via `src/fix/action-policy.ts`)

## Problem

The confirmation modal (`src/fix/confirm-modal.ts`) and the report view
(`src/report/`) do not consume the policy that Task 2.1 now attaches to every
fix-bearing finding. Concretely:

- The modal renders a flat file list of resolved action target paths. It shows
  no file size, no modification time, no inbound-reference count, no coverage
  state, and no retained duplicate path beyond the keep radio labels. The user
  confirms "move 2 files to trash" without seeing what those files are.
- `InspectorView.renderMainActionBar` builds `selectedFixable` with
  `issue.fixAction !== undefined` only: a `blocked` unverified finding and a
  `review-required` candidate finding are silently bundled into the batch fix
  button. The only per-item friction that exists today is the duplicate keep
  choice (`shouldAskForKeep`), and it applies only to duplicate groups — an
  orphan-attachment or empty-note trash candidate is confirmed by one click on
  a shared Confirm button.
- The report rows never say whether a finding's fix is eligible, needs review,
  or is blocked, or why — the policy is invisible until the modal opens (and
  then only partially).

Task 2.2 makes the policy visible and binding at the point of confirmation:
the review shows the real impact, destructive candidates cannot ride along in
a bulk selection, review-required items need an explicit per-item decision,
and blocked items render their reason with no confirm control.

## Goals

Exactly the roadmap's "must show" list, rendered inside the confirmation
modal (per action item) and summarized in the report row:

- file paths, size, and modification time of every target file;
- known inbound references (count over the action's `targetPaths`);
- reference-coverage completeness;
- which duplicate path will be retained;
- note modifications vs files moved to trash (already in
  `describeFixActions`, now per item);
- why an action requires review or is blocked.

Required behavior (roadmap checkboxes):

- bulk selection does not silently include destructive candidate actions;
- review-required actions need an explicit per-item decision;
- blocked actions render the reason and expose no confirm control;
- narrow layouts keep paths and decisions readable;
- the confirmation model and the rendered controls enforce the SAME policy —
  one shared derivation over `Issue.eligibility` / `Issue.impact`.

## Non-goals (this PR)

- No change to fix execution semantics — `fix-decisions.ts`, `fix-runner.ts`,
  `fix-executor.ts`, and `action-outcomes.ts` are Task 2.3's scope. This task
  changes what the user sees and which decisions the modal returns, not how
  decisions execute.
- No new settings, no scanner changes, no CLI changes (the CLI already
  serializes `eligibility`/`impact` additively from Task 2.1).
- No fingerprint, snapshot, or `COMPARISON_VERSION` changes — this is
  presentation only.
- No per-path reference listing inside the modal (the shared reference index
  is not passed to the modal; the aggregate `impact.inboundReferences` and
  duplicate `evidence.referenceCounts` are shown instead).

## Design

### One shared eligibility view: `resolveEligibility`

Task 2.1 guarantees `ScanRunner` annotates every fix-bearing issue with
`eligibility` and `impact`. But hand-built issues (tests, defensive paths) and
any future consumer may lack the field. Both the modal and the report call one
function exported from `src/fix/confirm-modal.ts`:

```ts
export function resolveEligibility(issue: Issue): FixEligibility {
	return issue.eligibility ?? "review-required";
}
```

A missing field degrades to `review-required` (conservative: the item can
still run after an explicit per-item decision, never silently). This is the
single point through which the confirmation model, the rendered modal
controls, the report rows, and the bulk-selection gate read the policy — the
"same policy" requirement is structural, not conventional.

### Tiered confirmation model in `confirm-modal.ts`

Three pure additions next to the existing helpers:

```ts
export type EligibilityGroups = {
	eligible: Issue[];
	reviewRequired: Issue[];
	blocked: Issue[];
};

export function groupByEligibility(issues: Issue[]): EligibilityGroups;

export type EligibilityExplanation = { status: string; reason: string };

export function describeEligibility(issue: Issue): EligibilityExplanation;

export type ConfirmationPlan = {
	groups: EligibilityGroups;
	actionable: Issue[];   // eligible + approved review-required
	complete: boolean;     // actionable non-empty and every actionable decision complete
};

export function buildConfirmationPlan(
	issues: Issue[],
	mode: DuplicateKeepMode,
	selectedKeeps: ReadonlyMap<string, string>,
	approvedReviews: ReadonlySet<string>,
): ConfirmationPlan;
```

`buildConfirmationPlan` reuses `buildFixDecisionState` unchanged: it filters
the input to the actionable set, delegates to
`buildFixDecisionState(actionable, mode, selectedKeeps)`, and reports
`complete: decisions.length > 0 && state.complete`. Nothing in
`fix-decisions.ts` changes; Task 2.3 can harden it independently.

**Approval rule for review-required items** — the explicit per-item decision:

- a review-required duplicate group (`fixAction.selection` present) is
  approved by a valid keep choice in `selectedKeeps` (the Milestone 1 flow —
  `shouldAskForKeep` already forces the radio group; choosing the retained
  path IS the decision, so no second checkbox is stacked on top);
- any other review-required item (orphan attachment, empty note, evidence
  gaps) is approved by its fingerprint appearing in `approvedReviews` — the
  modal renders one unchecked checkbox per item ("I reviewed this file")
  that adds the fingerprint;
- unapproved review-required items are listed with their impact and reason
  but are excluded from `actionable`; they never block the rest of the batch.

`blocked` items are never actionable under any input.

`describeEligibility` maps the tier plus the underlying evidence to
sentence-case strings (Obsidian review requires sentence-case UI copy):

| Condition | `status` | `reason` |
| --- | --- | --- |
| `unverified` classification | `Blocked` | `The finding is unverified, so its fix cannot run.` |
| `trash-file` and `!impact.coverageComplete` | `Blocked` | `Reference coverage is incomplete, so files cannot be moved to trash safely.` |
| `selection.requiresReview === true` | `Review required` | `Several copies are referenced, so an explicit keep choice is required.` |
| `classification !== "confirmed"` (candidate) | `Review required` | `The finding needs review before its fix can run.` |
| incomplete `remove-link-text` evidence | `Review required` | `The replacement text is not fully specified.` |
| otherwise | `Eligible` | `The fix is confirmed and its evidence is complete.` |

Checked in that order; the `status` always derives from
`resolveEligibility(issue)` (never from the reason branch), so the tier and
its explanation can never disagree. The reason for `eligible` exists so
report rows can carry the same explanation. These are the exact strings both
the modal and the report render — one function, two consumers.

### Impact preview rows in the modal

```ts
export type FileStatInfo = { size: number; mtime: number };

export type ImpactRow = {
	path: string;
	size: string;   // formatSize(size) or "Size unknown"
	mtime: string;  // toLocaleDateString or "Modified date unknown"
};

export function buildImpactRows(
	paths: string[],
	stats: ReadonlyMap<string, FileStatInfo>,
): ImpactRow[];
```

The modal (which extends `Modal` and owns `this.app`) collects stats
render-side by looking each target path up with
`app.vault.getAbstractFileByPath` and reading `TFile.stat` (`{ size, mtime }`).
The row builder itself stays pure and takes the stat map, so tests inject a
literal map. Files whose path is missing from the map render explicit
"Size unknown" / "Modified date unknown" text rather than silently dropping
the row — every target path is always listed.

Per action item the modal card shows:

- the action description (`Keep "a.png" and move 2 duplicate(s) to trash`,
  note-modification wording for `remove-link-text`);
- impact rows for every `fixAction.targetPath`: path, size, modified date
  (monospace path, `overflow-wrap: anywhere`);
- `Inbound references: N · Reference coverage: complete|incomplete` from
  `issue.impact` (the aggregate over the same target paths the policy
  computed);
- for duplicate groups: the retained path that the current decision implies —
  `selectedKeeps.get(fingerprint) ?? selection.automaticKeepPath` — labeled
  `Keep`, updating live as the radio changes;
- the `describeEligibility` reason line for review-required and blocked items.

The existing header summary (`summarizeFixActions` over resolved actions of
the actionable set) is kept: it distinguishes "modify N notes" from "move M
files to trash" for the whole batch; the cards carry the per-item detail.

### Modal layout per tier

- **Blocked**: card with title, reason, impact rows, and the tier badge. No
  checkbox, no radio, no Confirm participation. The Confirm button's enabled
  state never depends on blocked items.
- **Review-required**: card with reason and impact. Duplicate groups show the
  existing keep radio group (`shouldAskForKeep` unchanged — always-ask mode
  still asks for plain groups too, and those groups are `eligible`, so the
  radio remains the familiar control); a made choice approves the group.
  Non-duplicate items show the per-item `I reviewed this file` checkbox.
  Unapproved items are visually muted but fully readable.
- **Eligible**: card with impact rows (and keep radios in always-ask mode).
  Included in the actionable set by default; no extra click is required, per
  Task 2.1's "eligible means bulk-executable under the policy".

The Confirm button is disabled unless `plan.complete` — i.e. at least one
actionable item exists and every actionable duplicate decision resolves.
Cancel still settles `null`.

### Bulk-selection gating (report side)

The roadmap lists `render-issues.ts` for this task; the fix button itself
lives in `InspectorView.renderMainActionBar`. The logic goes where the
roadmap points, the wiring where the code is:

- `src/report/render-issues.ts` exports a pure gate:

  ```ts
  export type BulkFixSelection = {
	  bulk: Issue[];          // eligibility === "eligible" only
	  reviewRequired: number; // selected but excluded, needs per-item review
	  blocked: number;        // selected but excluded, cannot run
  };

  export function selectBulkFixable(selected: Issue[]): BulkFixSelection;
  ```

  Only `eligibility === "eligible"` issues may enter the one-click batch.
  Review-required findings remain fixable through the modal's per-item
  decision only if the user re-selects them individually — but the roadmap's
  requirement is that bulk selection never *silently* includes them, so the
  batch button itself carries only eligible items.

- `InspectorView.renderMainActionBar` switches `selectedFixable` to
  `selectBulkFixable(selectedIssues)`, renders the button from
  `selection.bulk`, and when `reviewRequired + blocked > 0` appends a muted
  count label, e.g. `2 need review`, with a tooltip explaining that
  review-required and blocked findings are excluded from the batch. Ignore
  and restore selection behavior is untouched (not fix actions).

  Deviation from the roadmap file list: `src/report/InspectorView.ts` is
  modified in addition to the listed files, because the batch fix button
  (lines 474–495) lives there, not in `render-issues.ts`. The policy logic
  itself lives in `render-issues.ts` as listed.

### Report rows surface the policy

`renderIssueDetails` gains one row for every `fixAction`-bearing issue,
rendered through the existing row machinery:

- label `Fix`, value token `Eligible` / `Review required` / `Blocked` with
  class `vi-eligibility-<tier>` (badge styling mirrors the classification
  badges);
- a second muted line with the `describeEligibility` reason, so "why" is
  visible before the modal opens.

This makes the report and the confirmation modal render the same status and
the same reason string from the same function.

### Styles

New classes in `styles.css` (all `var(--…)` colors, no `gap` property —
`src/tests/styles.test.ts` pins both):

- `.vi-eligibility-badge` + `.vi-eligibility-eligible` / `-review-required` /
  `-blocked` — inline badge matching `.vi-classification-badge` metrics;
- `.vi-impact-card`, `.vi-impact-card-title`, `.vi-impact-rows`,
  `.vi-impact-row`, `.vi-impact-row-path`, `.vi-impact-row-meta` —
  `flex-wrap: wrap` rows with `min-width: 0` and `overflow-wrap: anywhere`
  on the path so long vault paths wrap instead of overflowing;
- `.vi-impact-card-muted` for unapproved review-required cards;
- `.vi-review-checkbox` (reuses `.vi-keep-option` layout metrics);
- inside the existing `@media (max-width: 500px)` block:
  `.vi-impact-row` stacks path above meta (`flex-direction: column`) and the
  keep radio rows already wrap; `.vi-bulk-excluded-note` wraps anywhere.

### Interaction with M1 `shouldAskForKeep`

Unchanged in behavior, elevated in role: for a `requiresReview` group the
keep choice is simultaneously the explicit per-item decision the policy
demands — the modal approves the group through `selectedKeeps` and
`buildFixDecisionState` still refuses to resolve the group without it.
Always-ask mode on an `eligible` group still asks (radio shown, tier
eligible), so the M1 keep-choice experience is preserved exactly and the
policy layer composes with it instead of replacing it.

## Test strategy

- `src/tests/confirm-modal.test.ts` (extended) pins:
  - `resolveEligibility` fallback (`undefined` → `review-required`);
  - `describeEligibility` status/reason for all six condition rows;
  - `groupByEligibility` split (three tiers, missing-field issue lands in
    review-required);
  - `buildConfirmationPlan`: blocked never actionable; unapproved
    review-required excluded; review-required duplicate approved by keep
    choice (no extra checkbox needed); non-duplicate review item approved by
    `approvedReviews`; `complete` false when an actionable keep choice is
    missing or when nothing is actionable; eligible-only batch complete
    without any extra input;
  - `buildImpactRows`: formats size and date from injected stats, renders
    explicit unknowns for missing stats, preserves path order;
  - existing `summarizeFixActions` / `shouldAskForKeep` tests keep passing
    unchanged (M1 behavior pinned).
- `src/tests/render-issue-actions.test.ts` (extended) pins:
  - the `Fix` row renders the tier token with the right class for eligible,
    review-required, blocked, and missing-field issues (missing field shows
    `Review required` — same policy as the modal);
  - the reason line renders the exact `describeEligibility` reason;
  - `selectBulkFixable` returns only eligible issues, counts the other two
    tiers, and passes non-fix-action issues into none of the counts.
- `src/tests/styles.test.ts` (extended) pins: the new
  `.vi-eligibility-*` and `.vi-impact-*` classes exist; the new report/modal
  block's backgrounds are all `var(--…)`; the 500px media block stacks
  `.vi-impact-row` and keeps paths wrappable; still no `gap` property.

## Verification strategy

```bash
npm test -- src/tests/confirm-modal.test.ts src/tests/render-issue-actions.test.ts src/tests/styles.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: the confirmation model and the rendered controls enforce the same
policy (both read `resolveEligibility`/`describeEligibility`); all
pre-existing tests pass unmodified except the two test files this task
extends additively.

## Precision-suite and CLI impact

None. The precision suite asserts scanner findings, not UI; the modal and
report consume `Issue` fields that Task 2.1 already annotates. The CLI
serializes issues unchanged — no CLI code, schema version, or stable field
moves. Fingerprints, snapshots, and `COMPARISON_VERSION` are untouched.

## Risks

- **`eligible` items confirm without any per-item gesture.** Intentional:
  Task 2.1's policy already requires confirmed classification, complete
  evidence, complete coverage (for trash), and no review flag for that tier;
  the batch-level Confirm click remains the consent event. The impact cards
  make the consequence visible, which is this task's mandate.
- **Vault stat lookups can miss renamed/moved files between scan and
  confirm.** Impact rows degrade to explicit "Size unknown" text, and Task
  2.3's preflight re-verifies before execution; the preview never fabricates
  data.
- **Modal grows for large batches.** Impact cards live inside the existing
  scrollable content area; the per-card layout is compact (one row per target
  path). Bulk fix only carries eligible items, which bounds the typical
  review-required card count to individually opened flows.
- **`InspectorView.ts` is modified despite not being on the roadmap file
  list.** Documented above; the alternative (duplicating the gate in the
  view) would split the policy a third way, which is exactly what this task
  removes.
