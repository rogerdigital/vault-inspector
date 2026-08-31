# Action Impact Policy Implementation Plan (Milestone 2, Task 2.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the roadmap's fix-action policy metadata as a pure, centrally derived module: `FixEligibility = "eligible" | "review-required" | "blocked"` and `FixImpact = { filesChanged, filesTrashed, inboundReferences, coverageComplete }`. New pure module `src/fix/action-policy.ts` exposes `deriveActionPolicy(issue, index)` and `withActionPolicy(issue, index)`; `Issue` gains additive optional top-level fields `eligibility?` and `impact?` (NOT on `FixAction` — the fields describe the finding plus scan-wide coverage state, `cli/cli.ts` spreads issues into JSON so top-level fields serialize additively with zero CLI changes, and `src/tests/cli.test.ts` pins `fixAction` with strict `toEqual`, which fields inside the action would break). Policy precedence: no action → no fields; `unverified` → `blocked`; `trash-file` under incomplete reference coverage → `blocked`; `candidate` → `review-required`; incomplete action evidence (`remove-link-text` without `original`+`replacement`, or `selection.requiresReview`) → `review-required`; otherwise confirmed → `eligible`. `ScanRunner.run` annotates every issue (active and ignored) after each scanner returns. Policy metadata never enters fingerprints and never mutates `evidence`. No UI, fix-execution, settings, scanner, or CLI behavior changes — Tasks 2.2/2.3 consume the policy.

**Architecture:** Types live in `src/scanner/Issue.ts` next to `FixAction` (avoids a type-only import cycle with `src/fix/action-policy.ts`, which imports `Issue`). Derivation is one pure function over `Issue + ReferenceIndex` in `src/fix/action-policy.ts`, called only from `ScanRunner.run`'s issue-collection loop — scanners stay pure detection units and need no edits, so scanner unit tests (which call `scanner.scan` directly) observe no change. The plugin and the CLI share the semantics because both go through `ScanRunner.run`. JSON output gains the fields via the existing issue spread in `cli/cli.ts`; nothing is removed or renamed.

**Tech Stack:** TypeScript, Vitest, `ReferenceIndex` literal fixtures

Design doc: `docs/superpowers/specs/2026-08-31-action-impact-policy-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 2, Task 2.1)

---

## Ground rules

- Branch: `feat/action-impact-review`, cut from latest `main`.
- One commit: `feat: define fix action impact policy`.
- Fields go on `Issue` (`eligibility?`, `impact?`), never inside `FixAction`. Never add a policy field to `FixAction`, `KeepOneSelection`, or any action shape compared by `fix-decisions.ts`.
- `deriveActionPolicy` must be pure: no `app.*`, no I/O, no clocks/randomness, no mutation of its inputs. Identical `(issue, index)` inputs produce deep-equal outputs.
- Rule order is frozen (first match wins): no action → none; `unverified` → `blocked`; `trash-file` + `!coverageComplete` → `blocked`; `candidate` → `review-required`; incomplete evidence → `review-required`; else `eligible`.
- Never read or write `issue.evidence` or `issue.fingerprint` in the derivation; never bump `COMPARISON_VERSION` (finding identity is unchanged).
- Findings without a `fixAction` gain no fields (the key is absent, not `undefined`-valued).
- Do not modify `src/scanner/scanners/*`, `src/fix/confirm-modal.ts`, `src/fix/fix-decisions.ts`, `src/fix/fix-runner.ts`, `src/fix/fix-executor.ts`, `src/report/*`, `src/settings/*`, `cli/*`, or `src/snapshot/*`.
- Do not modify the precision fixture files (`src/tests/fixtures/precision-vault/**`); the precision suite itself needs no edits (every fix-action assertion there uses `toMatchObject`/`toBeUndefined`/field access).
- Never `eslint-disable` any `obsidianmd/*` rule.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/action-impact-review
```

---

### Task 2: Write the policy unit tests first (TDD)

**Files:**
- Create: `src/tests/action-policy.test.ts`

- [ ] **Step 1: Create the test file with exactly this content**

```typescript
import { describe, expect, it } from "vitest";
import type { Issue } from "../scanner/Issue";
import type { ReferenceIndex } from "../scanner/reference-index";
import {
	deriveActionPolicy,
	withActionPolicy,
} from "../fix/action-policy";

function makeIndex(
	overrides: {
		inbound?: Record<string, number>;
		coverageComplete?: boolean;
	} = {},
): ReferenceIndex {
	return {
		inboundByPath: new Map(
			Object.entries(overrides.inbound ?? {}).map(([path, count]) => [
				path,
				{ count, kinds: [], sources: [] },
			]),
		),
		canvasFiles: [],
		coverageFailures: [],
		coverageComplete: overrides.coverageComplete ?? true,
	};
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		scannerId: "orphan-attachments",
		severity: "warning",
		title: "Orphan attachment",
		message: "This attachment is not referenced by any note",
		classification: "candidate",
		explanation: { why: "why", nextStep: "next step" },
		primaryPath: "attachments/orphan.png",
		relatedPaths: [],
		evidence: {},
		fingerprint: "fingerprint",
		...overrides,
	};
}

describe("deriveActionPolicy", () => {
	it("returns null for findings without a fix action", () => {
		const issue = makeIssue();
		expect(deriveActionPolicy(issue, makeIndex())).toBeNull();
	});

	it("blocks unverified findings regardless of action shape", () => {
		const issue = makeIssue({
			classification: "unverified",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(deriveActionPolicy(issue, makeIndex())?.eligibility).toBe("blocked");
	});

	it("blocks trash actions when reference coverage is incomplete", () => {
		const issue = makeIssue({
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ coverageComplete: false }))?.eligibility,
		).toBe("blocked");
	});

	it("blocked outranks review-required: candidate trash under incomplete coverage is blocked", () => {
		const issue = makeIssue({
			classification: "candidate",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ coverageComplete: false }))?.eligibility,
		).toBe("blocked");
	});

	it("marks confirmed trash under incomplete coverage as blocked", () => {
		const issue = makeIssue({
			classification: "confirmed",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ coverageComplete: false }))?.eligibility,
		).toBe("blocked");
	});

	it("marks candidate findings as review-required even with complete coverage", () => {
		const issue = makeIssue({
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "a.md" to trash',
				targetPaths: ["a.md"],
			},
		});
		expect(deriveActionPolicy(issue, makeIndex())?.eligibility).toBe("review-required");
	});

	it("marks confirmed remove-link-text actions without replacement evidence as review-required", () => {
		const missingReplacement = makeIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
			},
		});
		const missingOriginal = makeIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove the link",
				targetPaths: ["notes/source.md"],
				replacement: "Missing",
			},
		});
		expect(deriveActionPolicy(missingReplacement, makeIndex())?.eligibility).toBe("review-required");
		expect(deriveActionPolicy(missingOriginal, makeIndex())?.eligibility).toBe("review-required");
	});

	it("marks review-required duplicate groups (requiresReview) as review-required despite confirmed classification", () => {
		const issue = makeIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png", "c.png"],
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
				targetPaths: ["b.png", "c.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png", "c.png"],
					automaticKeepPath: "a.png",
					referencedPaths: ["a.png", "b.png"],
					requiresReview: true,
				},
			},
		});
		expect(deriveActionPolicy(issue, makeIndex())?.eligibility).toBe("review-required");
	});

	it("marks confirmed findings with complete evidence as eligible", () => {
		const brokenLink = makeIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: 'Replace "[Missing](missing.md)" with "Missing" in "notes/source.md"',
				targetPaths: ["notes/source.md"],
				original: "[Missing](missing.md)",
				replacement: "Missing",
			},
		});
		expect(deriveActionPolicy(brokenLink, makeIndex())?.eligibility).toBe("eligible");

		const duplicateGroup = makeIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png"],
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: 'Keep "a.png" and move 1 duplicate(s) to trash',
				targetPaths: ["b.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png"],
					automaticKeepPath: "a.png",
					referencedPaths: [],
					requiresReview: false,
				},
			},
		});
		expect(deriveActionPolicy(duplicateGroup, makeIndex())?.eligibility).toBe("eligible");
	});

	it("computes impact for a note-modifying action", () => {
		const issue = makeIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Replace the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
				replacement: "Missing",
			},
		});
		expect(deriveActionPolicy(issue, makeIndex({ inbound: { "notes/source.md": 3 } }))).toEqual({
			eligibility: "eligible",
			impact: {
				filesChanged: 1,
				filesTrashed: 0,
				inboundReferences: 3,
				coverageComplete: true,
			},
		});
	});

	it("computes impact for a trash action from the shared reference index", () => {
		const issue = makeIssue({
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
				targetPaths: ["b.png", "c.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png", "c.png"],
					automaticKeepPath: "a.png",
					referencedPaths: ["b.png"],
					requiresReview: true,
				},
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ inbound: { "a.png": 2, "b.png": 1 } })),
		).toEqual({
			eligibility: "review-required",
			impact: {
				filesChanged: 0,
				filesTrashed: 2,
				inboundReferences: 1,
				coverageComplete: true,
			},
		});
	});

	it("reports incomplete coverage in the impact", () => {
		const issue = makeIssue({
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Replace the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
				replacement: "Missing",
			},
		});
		expect(
			deriveActionPolicy(issue, makeIndex({ coverageComplete: false }))?.impact.coverageComplete,
		).toBe(false);
	});

	it("is deterministic: identical inputs produce deep-equal outputs and never mutate the issue", () => {
		const issue = makeIssue({
			classification: "confirmed",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Replace the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
				replacement: "Missing",
			},
		});
		const index = makeIndex({ inbound: { "notes/source.md": 1 } });
		const before = JSON.stringify(issue);

		const first = deriveActionPolicy(issue, index);
		const second = deriveActionPolicy(issue, index);

		expect(first).toEqual(second);
		expect(JSON.stringify(issue)).toBe(before);
	});
});

describe("withActionPolicy", () => {
	it("returns issues without a fix action untouched (no new keys)", () => {
		const issue = makeIssue();
		const annotated = withActionPolicy(issue, makeIndex());
		expect(annotated).toBe(issue);
		expect("eligibility" in annotated).toBe(false);
		expect("impact" in annotated).toBe(false);
	});

	it("annotates fix-bearing issues and preserves the fingerprint and evidence", () => {
		const issue = makeIssue({
			evidence: { referenceCount: 0, coverageComplete: true },
			fingerprint: "stable-fingerprint",
			fixAction: {
				kind: "trash-file",
				label: "Delete",
				description: 'Move "attachments/orphan.png" to trash',
				targetPaths: ["attachments/orphan.png"],
			},
		});
		const annotated = withActionPolicy(issue, makeIndex());
		expect(annotated).not.toBe(issue);
		expect(annotated.eligibility).toBe("review-required");
		expect(annotated.impact).toEqual({
			filesChanged: 0,
			filesTrashed: 1,
			inboundReferences: 0,
			coverageComplete: true,
		});
		expect(annotated.fingerprint).toBe("stable-fingerprint");
		expect(annotated.evidence).toEqual({ referenceCount: 0, coverageComplete: true });
	});
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/action-policy.test.ts
```

Expected: FAIL — `src/fix/action-policy.ts` does not exist (unresolved import), and `Issue` has no `eligibility`/`impact` fields yet.

---

### Task 3: Add the policy types to `Issue`

**Files:**
- Modify: `src/scanner/Issue.ts`

- [ ] **Step 1: Add the type definitions and Issue fields**

In `src/scanner/Issue.ts`, insert after the `FixAction` type declaration
(after the closing `};` of `FixAction`, before
`export type FindingClassification = ...`, currently line 38):

```typescript
/**
 * Whether a fix action may execute, derived centrally from the finding's
 * classification, action-evidence completeness, and reference coverage.
 * Never part of a fingerprint.
 */
export type FixEligibility = "eligible" | "review-required" | "blocked";

/**
 * Impact preview for a fix action, derived from the shared reference index.
 * Plain JSON values only. Never part of a fingerprint.
 */
export type FixImpact = {
	filesChanged: number;
	filesTrashed: number;
	inboundReferences: number;
	coverageComplete: boolean;
};
```

Then extend the `Issue` type: insert after the `fixAction?: FixAction;`
line (currently line 57), as the last fields of the type:

```typescript
	/** Policy decision for `fixAction`; absent when there is no fix action. */
	eligibility?: FixEligibility;
	/** Impact preview for `fixAction`; absent when there is no fix action. */
	impact?: FixImpact;
```

The fields are optional and additive — every existing constructor of `Issue`
(in scanners, tests, and snapshot code) compiles unchanged.

---

### Task 4: Implement the policy module

**Files:**
- Create: `src/fix/action-policy.ts`

- [ ] **Step 1: Create the file with exactly this content**

```typescript
import type {
	FixAction,
	FixEligibility,
	FixImpact,
	Issue,
} from "../scanner/Issue";
import {
	getInboundReference,
	type ReferenceIndex,
} from "../scanner/reference-index";

export type ActionPolicy = {
	eligibility: FixEligibility;
	impact: FixImpact;
};

/**
 * Derives the action policy for one finding. Pure: reads only the issue's
 * classification and fix action plus the shared reference index; never
 * mutates its inputs; never touches `evidence` or `fingerprint`, so policy
 * metadata cannot enter issue fingerprints. Returns null when the finding
 * carries no fix action.
 *
 * Eligibility rules, first match wins (blocked outranks review-required):
 * 1. unverified finding -> blocked;
 * 2. trash action while reference coverage is incomplete -> blocked;
 * 3. candidate finding -> review-required;
 * 4. incomplete action evidence -> review-required
 *    (remove-link-text without original+replacement, or a duplicate group
 *    flagged requiresReview: referenced copies must not be bulk-trashed);
 * 5. otherwise (confirmed, complete evidence) -> eligible.
 */
export function deriveActionPolicy(
	issue: Issue,
	index: ReferenceIndex,
): ActionPolicy | null {
	const action = issue.fixAction;
	if (!action) return null;

	const impact = computeImpact(action, index);

	let eligibility: FixEligibility;
	if (issue.classification === "unverified") {
		eligibility = "blocked";
	} else if (action.kind === "trash-file" && !impact.coverageComplete) {
		eligibility = "blocked";
	} else if (issue.classification !== "confirmed") {
		eligibility = "review-required";
	} else if (!actionEvidenceComplete(action)) {
		eligibility = "review-required";
	} else {
		eligibility = "eligible";
	}

	return { eligibility, impact };
}

/**
 * Returns a copy of the issue annotated with `eligibility` and `impact` when
 * it carries a fix action, or the issue itself (same reference, no new keys)
 * when it does not.
 */
export function withActionPolicy(
	issue: Issue,
	index: ReferenceIndex,
): Issue {
	const policy = deriveActionPolicy(issue, index);
	if (!policy) return issue;
	return {
		...issue,
		eligibility: policy.eligibility,
		impact: policy.impact,
	};
}

function actionEvidenceComplete(action: FixAction): boolean {
	if (action.kind === "remove-link-text") {
		return action.original !== undefined && action.replacement !== undefined;
	}
	// trash-file: a keep-one group with 2+ referenced paths demands an
	// explicit keep choice, so it is never bulk-eligible.
	return action.selection?.requiresReview !== true;
}

function computeImpact(action: FixAction, index: ReferenceIndex): FixImpact {
	const trashing = action.kind === "trash-file";
	const inboundReferences = action.targetPaths.reduce(
		(total, path) => total + (getInboundReference(index, path)?.count ?? 0),
		0,
	);
	return {
		filesChanged: trashing ? 0 : action.targetPaths.length,
		filesTrashed: trashing ? action.targetPaths.length : 0,
		inboundReferences,
		coverageComplete: index.coverageComplete,
	};
}
```

- [ ] **Step 2: Run the policy unit tests**

```bash
npm test -- src/tests/action-policy.test.ts
```

Expected: PASS (15 tests: 13 in `deriveActionPolicy`, 2 in `withActionPolicy`).

---

### Task 5: Derive the policy in `ScanRunner`

**Files:**
- Modify: `src/scanner/ScanRunner.ts`

- [ ] **Step 1: Add the import**

Extend the imports at the top of `src/scanner/ScanRunner.ts` (after the
existing `import { buildReferenceIndex } from "./reference-index";`, line 5)
with:

```typescript
import { withActionPolicy } from "../fix/action-policy";
```

- [ ] **Step 2: Annotate every collected issue**

Replace the issue-collection loop (currently lines 125–131):

```typescript
			for (const issue of result) {
				if (ctx.ignoredFingerprints.has(issue.fingerprint)) {
					ignoredIssues.push(issue);
				} else {
					issues.push(issue);
				}
			}
```

with:

```typescript
			for (const issue of result) {
				// Central policy derivation: scanners stay pure detection
				// units; eligibility/impact never enters the fingerprint.
				const annotated = withActionPolicy(issue, referenceIndex);
				if (ctx.ignoredFingerprints.has(annotated.fingerprint)) {
					ignoredIssues.push(annotated);
				} else {
					issues.push(annotated);
				}
			}
```

`withActionPolicy` returns the same reference (and fingerprint) for
fix-less findings, so the ignore-list check is byte-identical for them.

- [ ] **Step 3: Run the runner and precision suites**

```bash
npm test -- src/tests/action-policy.test.ts src/tests/scan-runner.test.ts src/tests/scanner-precision.test.ts
```

Expected: PASS. The precision assertions are all `toMatchObject`,
`toBeUndefined`, or field access, so the two additive fields on fix-bearing
findings change no outcome. Scanner unit tests (`orphan-attachments`,
`empty-notes`, `duplicate-files`, `broken-links`) call scanners directly and
observe no change — the roadmap's "Modify: scanner tests that expose fix
actions" line resolves to zero edits, per the design doc's derivation-point
decision.

---

### Task 6: Add the additive CLI test

**Files:**
- Modify: `src/tests/cli.test.ts`

- [ ] **Step 1: Add one test to the `runCli` describe block**

Insert after the "reports missing Markdown files without an unsafe wiki
removal action" test (which ends around line 675):

```typescript
	it("adds additive eligibility and impact fields to fix actions while keeping fix metadata stable", async () => {
		await withVault(
			{
				"notes/source.md": "[Missing](missing.md)\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"broken-links",
				]);

				expect(result.exitCode).toBe(1);
				const issues = JSON.parse(result.stdout).issues;
				expect(issues).toEqual([
					expect.objectContaining({
						scannerId: "broken-links",
						classification: "confirmed",
						eligibility: "eligible",
						impact: {
							filesChanged: 1,
							filesTrashed: 0,
							inboundReferences: 0,
							coverageComplete: true,
						},
					}),
				]);
				// Every pre-existing fix-action field is emitted unchanged.
				expect(issues[0].fixAction).toEqual({
					kind: "remove-link-text",
					label: "Remove link",
					description:
						'Replace "[Missing](missing.md)" with "Missing" in "notes/source.md"',
					targetPaths: ["notes/source.md"],
					original: "[Missing](missing.md)",
					replacement: "Missing",
				});
			},
		);
	});

	it("marks candidate trash findings as review-required in CLI output", async () => {
		await withVault(
			{
				"empty.md": "# Empty\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					"scan",
					vaultPath,
					"--scanner",
					"empty-notes",
				]);

				expect(result.exitCode).toBe(1);
				const issues = JSON.parse(result.stdout).issues;
				expect(issues).toEqual([
					expect.objectContaining({
						scannerId: "empty-notes",
						classification: "candidate",
						eligibility: "review-required",
						impact: {
							filesChanged: 0,
							filesTrashed: 1,
							inboundReferences: 0,
							coverageComplete: true,
						},
					}),
				]);
				expect(issues[0].fixAction).toMatchObject({
					kind: "trash-file",
					targetPaths: ["empty.md"],
				});
			},
		);
	});
```

Note on the second test: the local-vault fixture `"empty.md": "# Empty\n"`
has no inbound references, so the empty-notes scanner emits its `trash-file`
action; the finding is `candidate`, hence `review-required`.

- [ ] **Step 2: Run the CLI suite**

```bash
npm test -- src/tests/cli.test.ts
```

Expected: PASS. The pre-existing strict `fixAction` `toEqual` assertions
(lines ~625 and ~662) still pass because the new fields live on the issue,
not inside the action.

---

### Task 7: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/action-policy.test.ts src/tests/cli.test.ts
```

Expected: PASS — policy decisions are pure, deterministic, and serialized
additively.

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0. No consumer suite (`fix-decisions`, `fix-runner`,
`confirm-modal`, `render-*`, `scan-snapshot`, `main`, `local-vault`) needed
edits: they compare fix actions and fingerprints, neither of which changed.

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/scanner/Issue.ts`, `src/scanner/ScanRunner.ts`,
`src/fix/action-policy.ts`, `src/tests/action-policy.test.ts`, and
`src/tests/cli.test.ts`. NOT any scanner, any fixture file, `cli/*`,
`src/report/*`, the other `src/fix/*` files, `src/settings/*`, or
`src/snapshot/*`.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/Issue.ts src/scanner/ScanRunner.ts src/fix/action-policy.ts src/tests/action-policy.test.ts src/tests/cli.test.ts
git commit -m "feat: define fix action impact policy"
git push -u origin feat/action-impact-review
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `feat: define fix action impact policy`, covering: `FixEligibility` /
  `FixImpact` types and additive `Issue.eligibility?` / `Issue.impact?`
  fields (on `Issue`, not `FixAction` — rationale: eligibility depends on
  classification and scan-wide coverage, CLI serializes issues by spread so
  the fields are additive with zero CLI changes, and strict `toEqual`
  fix-action pins and `fix-decisions` action comparisons stay intact); pure
  central derivation in `src/fix/action-policy.ts` invoked once by
  `ScanRunner.run` for active and ignored issues (scanners unchanged); the
  frozen rule precedence including candidate-trash-under-incomplete-coverage
  → `blocked` and `requiresReview` duplicate groups → `review-required`;
  impact computed from `targetPaths` and the shared reference index;
  fingerprints and `evidence` untouched, no `COMPARISON_VERSION` bump; no
  UI/execution changes (Tasks 2.2/2.3 consume the policy); focused tests
  plus full gates run.

## Self-review checklist (completed during plan writing)

- Roadmap Task 2.1 requirements ↔ tasks: `FixEligibility`/`FixImpact` type sketch exactly ✓ (Task 3, verbatim field names `filesChanged`, `filesTrashed`, `inboundReferences`, `coverageComplete`); new pure module `src/fix/action-policy.ts` ✓ (Task 4); `src/tests/action-policy.test.ts` ✓ (Task 2); `Issue.ts` modified additively ✓ (Task 3); `cli.test.ts` modified ✓ (Task 6); scanner tests that expose fix actions — zero edits needed, deviation documented with rationale (scanner unit tests call scanners directly; the central derivation point means no scanner emits policy fields).
- Policy checkboxes: confirmed may be eligible when action evidence is complete ✓ (rule 5, gated by `actionEvidenceComplete`); candidate findings at least review-required ✓ (rule 3; blocked can outrank via rule 2, "at least" satisfied since `blocked` is stricter); unverified blocked ✓ (rule 1); incomplete reference coverage blocks trash actions ✓ (rule 2, central — closes the empty-note gap the design doc identifies); additive JSON fields keep existing stable fix metadata ✓ (Task 6 pins the exact pre-change `fixAction` shape via strict `toEqual`).
- Roadmap focused-verification command reproduced in Task 7 Step 1 with the roadmap's expected outcome ("pure, deterministic, and serialized additively").
- No placeholders: Tasks 2, 4 ship complete file contents; Tasks 3, 5, 6 quote the exact current file contents before replacement (verified against `src/scanner/Issue.ts` lines 25–38/57, `src/scanner/ScanRunner.ts` lines 5 and 125–131, and `src/tests/cli.test.ts` around the "reports missing Markdown files" test ending near line 675).
- Type/name consistency verified against the codebase: `FixAction` fields (`kind`, `label`, `description`, `targetPaths`, `linkText?`, `original?`, `replacement?`, `selection?`) and `KeepOneSelection` (`requiresReview?`) match `src/scanner/Issue.ts`; `getInboundReference` and `ReferenceIndex` (`inboundByPath`, `coverageFailures`, `coverageComplete`) match `src/scanner/reference-index.ts`; the CLI test's expected `fixAction` shape is copied from the existing passing assertion at `src/tests/cli.test.ts` line ~662 (same fixture `"notes/source.md": "[Missing](missing.md)\n"`).
- Fingerprint safety verified: `generateFingerprint` (`src/scanner/issue-fingerprint.ts`) reads only `scannerId`/`primaryPath`/`evidence`; the derivation touches neither, annotation happens in `ScanRunner` after scanners computed fingerprints, and `withActionPolicy` preserves the fingerprint value (test-pinned). No `COMPARISON_VERSION` bump — finding identity is unchanged.
- Duplicate/orphan/empty-note gating interactions pinned: duplicate `requiresReview` → `review-required` despite `confirmed` (Task 2 test); orphan findings are `candidate` → `review-required` with complete coverage, and the scanner already withholds the action entirely under incomplete coverage (rule 0, no fields); empty-note referenced stubs lose the action at the scanner (no fields) while unreferenced candidate stubs are `review-required`, and an empty-note trash under incomplete coverage is now centrally `blocked`.
- CLI/precision impact expected: none beyond additive fields — `toJsonPayload`/`applyOutputFilters` spread issues (`cli/cli.ts`), so the fields serialize automatically; every precision fix-action assertion uses `toMatchObject`/`toBeUndefined`/field access; scanner unit tests bypass `ScanRunner`. The full-suite gate in Task 7 Step 2 is the safety net if any unstated strict comparison existed.
