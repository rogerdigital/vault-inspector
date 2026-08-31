# Action Impact Policy Design (Milestone 2, Task 2.1)

Date: 2026-08-31
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 2, Task 2.1)

## Problem

Every fix-bearing finding carries a `fixAction` (`src/scanner/Issue.ts`) but no
machine-readable statement of **whether** the action may run and **what** it
would touch. The policy knowledge is scattered and partly implicit:

- Orphan attachments suppress their `trash-file` action while reference
  coverage is incomplete (`src/scanner/scanners/orphan-attachments.ts`), but
  empty notes do not — an empty-note `trash-file` action is emitted regardless
  of Canvas coverage failures, even though an unparsed Canvas file could
  reference the note's attachments or the note itself could be a Canvas file
  target.
- Duplicate groups express "referenced copies need explicit review" only
  through `selection.requiresReview` (`KeepOneSelection`), which the
  confirmation modal interprets; nothing on the issue tells the report, the
  CLI, or a future batch executor that this confirmed finding's action is
  effectively *not* bulk-eligible.
- Classifications (`confirmed` / `candidate` / `unverified`) already encode
  finding confidence, but nothing maps that confidence onto action safety:
  today an `unverified` finding could in principle carry a fix action and
  nothing structural would object.

Task 2.2 (impact preview in the confirm modal) and Task 2.3 (policy-enforced
batch execution) both need one authoritative, pure source for "may this action
run, and what does it touch?" This task defines that source without changing
any execution or UI behavior.

## Goals

- Exactly the roadmap type sketch:

  ```ts
  type FixEligibility = "eligible" | "review-required" | "blocked";

  type FixImpact = {
  	filesChanged: number;
  	filesTrashed: number;
  	inboundReferences: number;
  	coverageComplete: boolean;
  };
  ```

- Required policy, exactly:
  - confirmed findings **may** be `eligible` when their action evidence is
    complete;
  - candidate findings are **at least** `review-required`;
  - unverified findings are `blocked`;
  - incomplete reference coverage blocks trash actions;
  - additive JSON fields do not remove or rename existing stable fix metadata.
- Decisions are pure, deterministic, and serializable (plain JSON values, no
  functions, Maps, or Sets in the output).
- Policy metadata never enters fingerprints.

## Non-goals (this PR)

- No changes to `confirm-modal.ts`, `fix-decisions.ts`, `fix-runner.ts`,
  `fix-executor.ts`, or any report rendering — Tasks 2.2 and 2.3 consume the
  policy; this PR only defines and derives it.
- No settings additions, no scanner behavior changes, no new findings.
- No enforcement anywhere: deriving `blocked` does not yet disable a confirm
  button (Task 2.2) or skip an action (Task 2.3).
- No CLI flags or schema-version bump.

## Design

### Where the types and fields live: `Issue`, not `FixAction`

The roadmap says "Add optional, additive fields" on the fix action. The
decision here: the types `FixEligibility` and `FixImpact` are defined in
`src/scanner/Issue.ts` next to `FixAction`, and the optional fields
`eligibility?: FixEligibility` and `impact?: FixImpact` are added to `Issue`
(top level), not to `FixAction`.

Justification:

1. **Eligibility is a property of the finding, not the action.** The same
   `trash-file` action is `review-required` on a candidate empty note and
   `eligible` on a confirmed duplicate group; the discriminator is
   `issue.classification` plus scan-wide coverage state. Attaching it to
   `FixAction` would make action objects context-dependent and would make
   `fix-decisions.ts`'s `resolveDecisionAction` (which clones and rewrites
   actions) responsible for re-deriving policy.
2. **CLI compatibility is provable today.** `cli/cli.ts` serializes issues by
   spreading them into the JSON payload (`toJsonPayload` emits
   `result.issues` wholesale, `applyOutputFilters` annotates with `{ ...issue,
   isNew }`), so top-level optional fields appear additively with zero CLI
   code changes. Meanwhile `src/tests/cli.test.ts` pins `fixAction` with
   strict `toEqual` (two broken-link assertions); fields inside `FixAction`
   would break those exact-equality assertions, and `fix-decisions.ts`
   compares action fields (`fixActionsMatch`, `getFreshFixAction`) — a policy
   field inside the action would leak into freshness comparisons and require
   excluding it everywhere.
3. **Fingerprint safety is structural.** `generateFingerprint`
   (`src/scanner/issue-fingerprint.ts`) reads only `scannerId`, `primaryPath`,
   and `evidence`. New top-level `Issue` keys cannot enter the hash, and the
   derivation function never touches `evidence` or `fingerprint`. The same is
   true for a `FixAction` field, but top-level placement additionally keeps
   the action object byte-identical to today, so snapshot issues, keep
   selections, and executor inputs are untouched.

`Issue` gains exactly:

```ts
eligibility?: FixEligibility;
impact?: FixImpact;
```

Both are absent (not `undefined`-valued) for findings without a `fixAction`,
so existing consumers that check `fixAction === undefined` see no change.

### Derivation point: central, in a pure module, invoked by `ScanRunner`

Decision: eligibility and impact are **derived centrally** from
`Issue + ReferenceIndex` by a pure function in a new module
`src/fix/action-policy.ts`. Scanners do not emit them.

Justification against per-scanner emission:

- Every policy input except the action's own completeness already lives on
  the issue (`classification`, `fixAction.kind`, `fixAction.selection`,
  `fixAction.original/replacement`) or in the shared reference index
  (`inboundByPath`, `coverageComplete`) — both available to `ScanRunner`
  after each scanner returns. Per-scanner emission would duplicate one rule
  eight times and invite drift (the empty-note coverage gap above is exactly
  what per-scenerio policy drift produces).
- Scanners stay pure detection units per the repository convention
  ("scanner logic stays in `src/scanner/scanners/`, keep Obsidian API
  coupling minimal"). Deriving after the scanner loop means no scanner test
  or fixture changes behavior.
- One derivation point gives the plugin and the CLI identical semantics
  automatically: `ScanRunner.run` annotates every issue (active and ignored)
  before returning, and the CLI serializes the result unchanged.

The module exports:

```ts
export function deriveActionPolicy(
	issue: Issue,
	index: ReferenceIndex,
): { eligibility: FixEligibility; impact: FixImpact } | null;

export function withActionPolicy(issue: Issue, index: ReferenceIndex): Issue;
```

`deriveActionPolicy` returns `null` when the issue has no `fixAction` (the
caller then leaves the issue untouched). `withActionPolicy` is the annotating
wrapper `ScanRunner` calls:

```ts
for (const issue of result) {
	const annotated = withActionPolicy(issue, referenceIndex);
	if (ctx.ignoredFingerprints.has(annotated.fingerprint)) {
		ignoredIssues.push(annotated);
	} else {
		issues.push(annotated);
	}
}
```

The annotation is a spread (`{ ...issue, eligibility, impact }`), so the
fingerprint value is carried through unchanged and the ignore-list check is
unaffected.

### Policy rules (deterministic precedence)

Evaluated in order; the first matching rule wins. `blocked` outranks
`review-required` so that a candidate trash action under incomplete coverage
is `blocked`, not merely reviewable.

| # | Condition | Eligibility |
| --- | --- | --- |
| 0 | no `fixAction` | no fields emitted |
| 1 | `classification === "unverified"` | `blocked` |
| 2 | `fixAction.kind === "trash-file"` and `!index.coverageComplete` | `blocked` |
| 3 | `classification === "candidate"` | `review-required` |
| 4 | action evidence incomplete (below) | `review-required` |
| 5 | otherwise (`classification === "confirmed"`, complete evidence, safe action) | `eligible` |

Rule 2 is the roadmap's "incomplete reference coverage blocks trash actions".
It is written centrally rather than per scanner, which closes the current gap
where empty-note trash actions ignore Canvas coverage failures. (The orphan
scanner already withholds its action under incomplete coverage, so rule 2 is
defense in depth there; for empty notes it is the only guard until Task 2.3
enforces it.)

Rule 4 — "action evidence complete" per action shape:

- `remove-link-text`: complete iff both `original` and `replacement` are
  defined. (The broken-links scanner already withholds the action when the
  source range is ambiguous, so this is normally satisfied; the rule exists so
  the policy degrades safely instead of certifying an under-specified
  replacement.)
- `trash-file` with `selection.requiresReview === true`: evidence is complete
  but the keep choice is not — a referenced duplicate group must not be
  `eligible` for bulk execution (Milestone 1's "referenced duplicates cannot
  be silently trashed" invariant, now expressed in one place).
- `trash-file` without a selection: complete.

### FixImpact semantics

Computed from `fixAction.targetPaths` and the shared reference index:

| Field | Value |
| --- | --- |
| `filesChanged` | `remove-link-text`: `targetPaths.length` (notes modified in place); `trash-file`: `0` |
| `filesTrashed` | `trash-file`: `targetPaths.length`; otherwise `0` |
| `inboundReferences` | sum of `getInboundReference(index, path)?.count ?? 0` over `targetPaths` |
| `coverageComplete` | `index.coverageComplete` |

For duplicate groups, `targetPaths` are the non-kept duplicates (after the
automatic keep choice), so `filesTrashed` and `inboundReferences` describe the
actual batch impact of the default decision. Every value is a number or
boolean — the result is directly JSON-serializable and depends only on the
issue and the index, so identical inputs yield identical outputs (test-pinned
determinism).

Interaction with the Milestone 1 gates:

- **Orphan coverage gating**: with complete coverage the finding is
  `candidate` with a `trash-file` action → `review-required` (external
  reference channels remain outside the boundary; correct). With incomplete
  coverage the scanner already emits no action → rule 0, no fields.
- **Empty-note reference gating**: referenced stubs already lose their action
  at the scanner (`fixAction === undefined`) → no fields. Unreferenced stubs
  are `candidate` → `review-required`. Under incomplete coverage, rule 2 now
  additionally marks such a trash action `blocked`.
- **Duplicate requiresReview**: unreferenced confirmed groups → `eligible`
  (the keep choice is deterministic and references are untouched);
  `requiresReview` groups (2+ referenced paths) → rule 4 → `review-required`.
- **Broken links**: confirmed with complete `original`/`replacement`
  evidence → `eligible`; findings whose fix was withheld for ambiguity have
  no action → no fields.

### Fingerprint and snapshot safety

- `deriveActionPolicy` reads `issue.classification` and `issue.fixAction` and
  writes only new top-level keys; it never reads or writes `evidence`.
  `generateFingerprint` inputs are therefore byte-identical before and after
  annotation.
- `toSnapshotIssue` (`src/snapshot/scan-snapshot.ts`) projects issues to
  compact snapshot entries (fingerprint-based), so persisted snapshots are
  unaffected. No `COMPARISON_VERSION` bump: detection semantics and finding
  identity are unchanged.

### CLI JSON impact

Additive only. `toJsonPayload` spreads issues, so fix-bearing findings gain:

```json
{
	"eligibility": "review-required",
	"impact": {
		"filesChanged": 0,
		"filesTrashed": 1,
		"inboundReferences": 0,
		"coverageComplete": true
	}
}
```

Every documented stable automation field — `schemaVersion`, `toolVersion`,
`summary`, `fingerprint`, `scannerId`, `severity`, paths, `evidence`, and all
existing fix-action metadata (`kind`, `label`, `description`, `targetPaths`,
`linkText`, `original`, `replacement`, `selection`) — is emitted unchanged.
Findings without a `fixAction` gain nothing. No CLI code changes.

## Precision-suite impact

None expected. The precision suite runs through `ScanRunner.run`
(`src/tests/helpers/fixture-vault.ts`), so fix-bearing findings gain the two
fields, but every fix-action assertion there uses `toMatchObject`,
`toBeUndefined`, or field access — none pin the full issue shape. Expected
eligibility outcomes in the fixture vault:

- broken-link fix actions → `eligible` (`filesChanged: 1`, `filesTrashed: 0`);
- the two orphan attachments → `review-required` (`filesTrashed: 1`);
- `notes/empty/cjk-stub.md` → `review-required`;
- the hash-identical duplicate group → `eligible` (fixture group has no
  inbound references, so `requiresReview` is false) with
  `filesTrashed: 1`, `inboundReferences: 0`.

Scanner unit tests construct issues by calling scanners directly (no
`ScanRunner`), so they observe no change — the roadmap's "Modify: scanner
tests that expose fix actions" line is satisfied with zero edits, documented
as a deviation with this rationale.

## Test strategy

- `src/tests/action-policy.test.ts` (new) — pins every rule row, every impact
  field, precedence (`candidate` + incomplete coverage + `trash-file` →
  `blocked`), the no-action null case, `withActionPolicy` leaving no-action
  issues untouched, and determinism (same inputs → deep-equal output).
- `src/tests/cli.test.ts` — one additive test: a broken-link scan's JSON
  issue carries `eligibility`/`impact` while the `fixAction` still equals its
  exact pre-change shape (proving stability of existing fix metadata).
- Full suite run to confirm no consumer test depended on the absence of the
  fields.

## Verification strategy

```bash
npm test -- src/tests/action-policy.test.ts src/tests/cli.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: policy decisions are pure, deterministic, and serialized
additively; all pre-existing tests pass unmodified (except the additive
`cli.test.ts` case).

## Risks

- **Fields exist but nothing enforces them yet.** Until Task 2.2/2.3 land,
  `blocked`/`review-required` are informational. Accepted: the roadmap
  sequences the policy definition first precisely so consumers have one
  contract to build against; the derivation is test-pinned in the meantime.
- **Rule 2 changes the *reported* eligibility of empty-note trash actions
  under incomplete coverage** from "action exists, safety unstated" to
  `blocked`. No UI consumes the field yet, so behavior is unchanged; the
  value is exactly what Task 2.2 will render.
- **Duplicate `eligible` could be read as "no review needed"**. The confirm
  modal still requires the keep decision flow today; Task 2.2 will render
  impact for `eligible` actions too. `eligible` means "bulk-executable under
  the policy", not "invisible".
