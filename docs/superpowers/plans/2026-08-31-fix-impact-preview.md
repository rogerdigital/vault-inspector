# Fix Impact Preview Implementation Plan (Milestone 2, Task 2.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Task 2.1 action policy (`Issue.eligibility` / `Issue.impact`, derived by `ScanRunner` via `src/fix/action-policy.ts`) visible and binding at the point of confirmation. The confirm modal (`src/fix/confirm-modal.ts`) renders one impact card per action item showing target paths, file size, modification time, inbound references, coverage completeness, and the retained duplicate path; blocked items render their reason with no confirm control; review-required items need an explicit per-item decision (keep choice for duplicate groups, `I reviewed this file` checkbox for everything else); eligible items are included by default. The batch fix button in `InspectorView.renderMainActionBar` carries only `eligibility === "eligible"` issues via a pure gate `selectBulkFixable` exported from `src/report/render-issues.ts`, with a visible "N need review" note for excluded items. Report rows gain a `Fix` status token plus the reason line. One shared derivation (`resolveEligibility` + `describeEligibility`, exported from `confirm-modal.ts`) feeds the confirmation model, the modal controls, the report rows, and the bulk gate — the same policy everywhere. No changes to `fix-decisions.ts`, `fix-runner.ts`, `fix-executor.ts`, scanners, settings, CLI, snapshots, or fingerprints.

**Architecture:** All policy-view logic is pure and lives in `src/fix/confirm-modal.ts` next to the existing summary helpers (`resolveEligibility`, `describeEligibility`, `groupByEligibility`, `isReviewApproved`, `buildConfirmationPlan`, `buildImpactRows`); the `ConfirmFixModal` class adds only render wiring plus a `collectStats` vault lookup (`app.vault.getAbstractFileByPath` → `TFile.stat`) so the pure row builder stays testable with an injected stat map. `buildConfirmationPlan` reuses `buildFixDecisionState` unchanged. `render-issues.ts` imports the shared helpers for its `Fix` row and the `selectBulkFixable` gate; `InspectorView.ts` switches its fix button to the gate (documented deviation: the roadmap file list names `render-issues.ts`, but the batch button lives in `InspectorView.ts` — the logic stays in `render-issues.ts` as listed). Styles are additive classes in `styles.css` (`var(--…)` colors only, no `gap` property) plus rules inside the existing 500px media block.

**Tech Stack:** TypeScript, Vitest, DOM-fake element fixtures (`src/tests/render-issue-actions.test.ts` pattern)

Design doc: `docs/superpowers/specs/2026-08-31-fix-impact-preview-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 2, Task 2.2)

---

## Ground rules

- Branch: `feat/fix-impact-preview`, cut from latest `main`.
- One commit: `feat: preview fix impact before confirmation`.
- The confirmation model and the rendered controls must consume the SAME policy: every eligibility read goes through `resolveEligibility` (missing field → `"review-required"`, conservative default); every status/reason string comes from `describeEligibility`. Never re-derive tiers from `classification`/`impact` ad hoc in a component.
- Blocked actions are never actionable under any input and render no confirm-participating control.
- Review-required items need an explicit per-item decision: a valid keep choice for duplicate groups (`shouldAskForKeep` flow, unchanged), an `approvedReviews` fingerprint for everything else. Unapproved review items are excluded from decisions but must not block the rest of the batch.
- Eligible items are actionable by default — no extra per-item click (Task 2.1 defines `eligible` as bulk-executable; the Confirm click is the consent event).
- Do not modify `src/fix/fix-decisions.ts`, `src/fix/fix-runner.ts`, `src/fix/fix-executor.ts`, `src/fix/action-policy.ts`, `src/scanner/*`, `src/settings/*`, `src/snapshot/*`, or `cli/*`.
- UI strings are sentence-case (Obsidian review convention); badges render the sentence-case text and let CSS `text-transform: uppercase` style them (same pattern as `.vi-severity-badge`).
- `styles.css`: only `var(--…)` color values, never a `gap` property (`src/tests/styles.test.ts` pins both); mobile rules go inside the FIRST `@media (max-width: 500px)` block (the one containing `.vi-stats`).
- Never `eslint-disable` any `obsidianmd/*` rule.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/fix-impact-preview
```

---

### Task 2: Write the failing tests first (TDD)

**Files:**
- Modify: `src/tests/confirm-modal.test.ts`
- Modify: `src/tests/render-issue-actions.test.ts`
- Modify: `src/tests/styles.test.ts`

- [ ] **Step 1: Extend `src/tests/confirm-modal.test.ts`**

Update the import at the top (lines 3–7) to:

```typescript
import {
	buildConfirmationPlan,
	buildImpactRows,
	createSingleUseResolver,
	describeEligibility,
	groupByEligibility,
	resolveEligibility,
	shouldAskForKeep,
	summarizeFixActions,
} from "../fix/confirm-modal";
```

Append the following fixture helper and describe block at the end of the file (after the closing `});` of `describe("confirm modal action summary", ...)`):

```typescript
function makeFixIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		scannerId: "orphan-attachments",
		severity: "warning",
		classification: "candidate",
		explanation: { why: "why", nextStep: "next step" },
		title: "Orphan attachment",
		message: "This attachment is not referenced by any note",
		primaryPath: "attachments/orphan.png",
		relatedPaths: [],
		evidence: {},
		fingerprint: "orphan",
		fixAction: {
			kind: "trash-file",
			label: "Delete",
			description: 'Move "attachments/orphan.png" to trash',
			targetPaths: ["attachments/orphan.png"],
		},
		...overrides,
	};
}

describe("fix impact preview policy", () => {
	it("treats a missing eligibility field as review-required", () => {
		expect(resolveEligibility(makeFixIssue())).toBe("review-required");
	});

	it("explains each eligibility tier with a sentence-case reason", () => {
		const unverified = makeFixIssue({
			classification: "unverified",
			eligibility: "blocked",
		});
		const incompleteCoverage = makeFixIssue({
			classification: "confirmed",
			eligibility: "blocked",
			impact: {
				filesChanged: 0,
				filesTrashed: 1,
				inboundReferences: 0,
				coverageComplete: false,
			},
		});
		const reviewGroup = makeFixIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			eligibility: "review-required",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png"],
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
				targetPaths: ["b.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png"],
					automaticKeepPath: "a.png",
					referencedPaths: ["a.png", "b.png"],
					requiresReview: true,
				},
			},
		});
		const candidate = makeFixIssue({ eligibility: "review-required" });
		const missingReplacement = makeFixIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			eligibility: "review-required",
			primaryPath: "notes/source.md",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Remove the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
			},
		});
		const eligible = makeFixIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			eligibility: "eligible",
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

		expect(describeEligibility(unverified)).toEqual({
			status: "Blocked",
			reason: "The finding is unverified, so its fix cannot run.",
		});
		expect(describeEligibility(incompleteCoverage)).toEqual({
			status: "Blocked",
			reason:
				"Reference coverage is incomplete, so files cannot be moved to trash safely.",
		});
		expect(describeEligibility(reviewGroup)).toEqual({
			status: "Review required",
			reason:
				"Several copies are referenced, so an explicit keep choice is required.",
		});
		expect(describeEligibility(candidate)).toEqual({
			status: "Review required",
			reason: "The finding needs review before its fix can run.",
		});
		expect(describeEligibility(missingReplacement)).toEqual({
			status: "Review required",
			reason: "The replacement text is not fully specified.",
		});
		expect(describeEligibility(eligible)).toEqual({
			status: "Eligible",
			reason: "The fix is confirmed and its evidence is complete.",
		});
	});

	it("groups fix-bearing issues by tier and ignores fix-less issues", () => {
		const eligible = makeFixIssue({
			classification: "confirmed",
			eligibility: "eligible",
		});
		const review = makeFixIssue({ eligibility: "review-required" });
		const blocked = makeFixIssue({
			classification: "unverified",
			eligibility: "blocked",
		});
		const missingField = makeFixIssue();

		const groups = groupByEligibility([
			eligible,
			review,
			blocked,
			missingField,
			{ ...makeFixIssue(), fixAction: undefined },
		]);

		expect(groups.eligible).toEqual([eligible]);
		expect(groups.reviewRequired).toEqual([review, missingField]);
		expect(groups.blocked).toEqual([blocked]);
	});

	it("never makes blocked actions actionable", () => {
		const plan = buildConfirmationPlan(
			[makeFixIssue({ classification: "unverified", eligibility: "blocked" })],
			"automatic",
			new Map(),
			new Set(["orphan"]),
		);
		expect(plan.actionable).toEqual([]);
		expect(plan.complete).toBe(false);
	});

	it("excludes unapproved review-required items but keeps the rest of the batch complete", () => {
		const eligible = makeFixIssue({
			scannerId: "broken-links",
			classification: "confirmed",
			eligibility: "eligible",
			primaryPath: "notes/source.md",
			fingerprint: "link",
			fixAction: {
				kind: "remove-link-text",
				label: "Remove link",
				description: "Replace the link",
				targetPaths: ["notes/source.md"],
				original: "[[Missing]]",
				replacement: "Missing",
			},
		});
		const plan = buildConfirmationPlan(
			[eligible, makeFixIssue({ eligibility: "review-required" })],
			"automatic",
			new Map(),
			new Set(),
		);
		expect(plan.groups.reviewRequired).toHaveLength(1);
		expect(plan.actionable).toEqual([eligible]);
		expect(plan.complete).toBe(true);
	});

	it("approves a review-required duplicate group through an explicit keep choice", () => {
		const group = makeFixIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			eligibility: "review-required",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png"],
			fingerprint: "dupes",
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
				targetPaths: ["b.png"],
				selection: {
					kind: "keep-one",
					candidatePaths: ["a.png", "b.png"],
					automaticKeepPath: "a.png",
					referencedPaths: ["a.png", "b.png"],
					requiresReview: true,
				},
			},
		});

		const undecided = buildConfirmationPlan(
			[group],
			"automatic",
			new Map(),
			new Set(),
		);
		expect(undecided.actionable).toEqual([]);
		expect(undecided.complete).toBe(false);

		const decided = buildConfirmationPlan(
			[group],
			"automatic",
			new Map([["dupes", "a.png"]]),
			new Set(),
		);
		expect(decided.actionable).toEqual([group]);
		expect(decided.complete).toBe(true);
	});

	it("approves a non-duplicate review-required item only through its fingerprint", () => {
		const issue = makeFixIssue({ eligibility: "review-required" });
		expect(
			buildConfirmationPlan([issue], "automatic", new Map(), new Set())
				.complete,
		).toBe(false);
		expect(
			buildConfirmationPlan([issue], "automatic", new Map(), new Set(["orphan"]))
				.complete,
		).toBe(true);
	});

	it("requires a keep choice for eligible duplicate groups in always-ask mode", () => {
		const group = makeFixIssue({
			scannerId: "duplicate-files",
			classification: "confirmed",
			eligibility: "eligible",
			primaryPath: undefined,
			relatedPaths: ["a.png", "b.png"],
			fingerprint: "dupes",
			fixAction: {
				kind: "trash-file",
				label: "Delete duplicates",
				description: "Keep a path and move duplicates to trash",
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
		expect(
			buildConfirmationPlan([group], "always-ask", new Map(), new Set())
				.complete,
		).toBe(false);
		expect(
			buildConfirmationPlan(
				[group],
				"always-ask",
				new Map([["dupes", "b.png"]]),
				new Set(),
			).complete,
		).toBe(true);
	});

	it("builds impact rows with size and modified date, degrading to explicit unknowns", () => {
		const mtime = Date.UTC(2026, 7, 29);
		const rows = buildImpactRows(
			["a.png", "gone.png"],
			new Map([["a.png", { size: 2048, mtime }]]),
		);
		expect(rows).toEqual([
			{
				path: "a.png",
				size: "2.0 KB",
				mtime: new Date(mtime).toLocaleDateString(),
			},
			{
				path: "gone.png",
				size: "Size unknown",
				mtime: "Modified date unknown",
			},
		]);
	});
});
```

- [ ] **Step 2: Extend `src/tests/render-issue-actions.test.ts`**

Extend the import from `../report/render-issues` (line 3) to:

```typescript
import { renderIssueList, selectBulkFixable } from "../report/render-issues";
```

Append at the end of the file (after the closing `});` of the existing describe block):

```typescript
function makeFixIssueWith(
	eligibility: "eligible" | "review-required" | "blocked" | undefined,
	path: string,
): Issue {
	return {
		...makeIssue(path),
		// Blocked fixtures are unverified, mirroring the only policy path
		// that annotates a fix-bearing finding as blocked with an otherwise
		// complete action shape.
		...(eligibility === "blocked"
			? { classification: "unverified" as const, eligibility }
			: eligibility
				? { eligibility }
				: {}),
		fixAction: {
			kind: "trash-file",
			label: "Delete",
			description: `Move "${path}" to trash`,
			targetPaths: [path],
		},
	};
}

describe("fix eligibility reporting and bulk gating", () => {
	it("renders a Fix status token and reason for fix-bearing issues", () => {
		for (const eligibility of ["eligible", "review-required", "blocked"] as const) {
			const container = new FakeElement();
			renderIssueList(container as any, {
				issues: [makeFixIssueWith(eligibility, "notes/file.md")],
				scannersRun: ["broken-links"],
				selectionMode: false,
				selectedFingerprints: new Set(),
				onOpenIssue: vi.fn(),
				onToggleSelect: vi.fn(),
			});
			const label = findByText(container, "Fix");
			expect(label?.cls).toContain("vi-issue-target-label");
			const token = findByText(
				container,
				eligibility === "eligible" ? "Eligible"
					: eligibility === "review-required" ? "Review required"
						: "Blocked",
			);
			expect(token?.cls.split(/\s+/)).toContain(
				`vi-eligibility-${eligibility}`,
			);
			const reason = findByText(
				container,
				describeReasonFor(eligibility),
			);
			expect(reason?.cls).toContain("vi-issue-fix-reason");
		}
	});

	it("treats a missing eligibility field as review-required in the report", () => {
		const container = new FakeElement();
		renderIssueList(container as any, {
			issues: [makeFixIssueWith(undefined, "notes/file.md")],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
		});
		expect(findByText(container, "Review required")).toBeDefined();
		expect(findByText(container, "Blocked")).toBeUndefined();
	});

	it("renders no fix row for issues without a fix action", () => {
		const container = new FakeElement();
		renderIssueList(container as any, {
			issues: [makeIssue("notes/file.md")],
			scannersRun: ["broken-links"],
			selectionMode: false,
			selectedFingerprints: new Set(),
			onOpenIssue: vi.fn(),
			onToggleSelect: vi.fn(),
		});
		expect(findByText(container, "Fix")).toBeUndefined();
		expect(
			container.children.some((child) =>
				(child.cls ?? "").includes("vi-issue-fix-reason")),
		).toBe(false);
	});

	it("limits bulk fix to eligible issues and counts the excluded tiers", () => {
		const eligible = makeFixIssueWith("eligible", "a.md");
		const review = makeFixIssueWith("review-required", "b.md");
		const blocked = makeFixIssueWith("blocked", "c.md");
		const plain = makeIssue("d.md");

		expect(selectBulkFixable([eligible, review, blocked, plain])).toEqual({
			bulk: [eligible],
			reviewRequired: 1,
			blocked: 1,
		});
	});
});

function describeReasonFor(
	eligibility: "eligible" | "review-required" | "blocked",
): string {
	if (eligibility === "eligible") {
		return "The fix is confirmed and its evidence is complete.";
	}
	if (eligibility === "blocked") {
		return "The finding is unverified, so its fix cannot run.";
	}
	return "The finding needs review before its fix can run.";
}
```

(The blocked fixture is `classification: "unverified"`-agnostic: the report
reads `issue.eligibility` via `resolveEligibility`, so `eligibility:
"blocked"` on the fixture is authoritative — exactly what Task 2.1's scanner
annotation guarantees for real issues.)

- [ ] **Step 3: Extend `src/tests/styles.test.ts`**

Append a new test inside the existing `describe("styles.css", ...)` block
(after the "keeps large report export actions reachable on narrow screens"
test):

```typescript
	it("styles fix impact preview elements and keeps them readable on narrow screens", async () => {
		const css = await readFile("styles.css", "utf8");

		for (const className of [
			"vi-eligibility-badge",
			"vi-eligibility-eligible",
			"vi-eligibility-review-required",
			"vi-eligibility-blocked",
			"vi-impact-card",
			"vi-impact-card-muted",
			"vi-impact-card-title",
			"vi-impact-reason",
			"vi-impact-rows",
			"vi-impact-row",
			"vi-impact-row-path",
			"vi-impact-row-meta",
			"vi-impact-coverage",
			"vi-impact-keep",
			"vi-review-checkbox",
			"vi-issue-fix-reason",
			"vi-bulk-excluded-note",
		]) {
			expect(css, `missing .${className}`).toContain(`.${className}`);
		}

		const impactStyles = css.slice(css.indexOf("/* Fix impact preview */"));
		expect(impactStyles.length).toBeGreaterThan(0);
		const backgrounds = [...impactStyles.matchAll(/background(?:-color)?\s*:\s*([^;]+);/g)]
			.map((match) => match[1].trim());
		expect(backgrounds.length).toBeGreaterThan(0);
		expect(backgrounds.every((value) => value.startsWith("var(--"))).toBe(true);
		expect(impactStyles).toMatch(/\.vi-impact-row\s*\{[^}]*flex-wrap:\s*wrap;/);
		expect(impactStyles).toMatch(/\.vi-impact-row-path\s*\{[^}]*overflow-wrap:\s*anywhere;/);

		const mobile = css.match(/@media\s*\(max-width:\s*500px\)\s*\{([\s\S]*?)\n\}/)?.[1];
		expect(mobile).toBeDefined();
		expect(mobile).toMatch(/\.vi-impact-row\s*\{[^}]*flex-direction:\s*column;/);
		expect(mobile).toMatch(/\.vi-bulk-excluded-note\s*\{[^}]*overflow-wrap:\s*anywhere;/);
	});
```

- [ ] **Step 4: Run and confirm failure**

```bash
npm test -- src/tests/confirm-modal.test.ts src/tests/render-issue-actions.test.ts src/tests/styles.test.ts
```

Expected: FAIL — `resolveEligibility`, `describeEligibility`,
`groupByEligibility`, `buildConfirmationPlan`, `buildImpactRows`, and
`selectBulkFixable` are not exported; the Fix row, reason line, and impact
styles do not exist.

---

### Task 3: Implement the confirmation model and modal in `src/fix/confirm-modal.ts`

**Files:**
- Modify: `src/fix/confirm-modal.ts`

- [ ] **Step 1: Update the imports (lines 1–8)**

Replace:

```typescript
import { App, Modal } from "obsidian";
import type { FixAction, Issue, KeepOneSelection } from "../scanner/Issue";
import type { DuplicateKeepMode } from "../settings/settings";
import {
	buildFixDecisionState,
	type FixDecision,
	resolveDecisionAction,
} from "./fix-decisions";
```

with:

```typescript
import { App, Modal, TFile } from "obsidian";
import type {
	FixAction,
	FixEligibility,
	Issue,
	KeepOneSelection,
} from "../scanner/Issue";
import type { DuplicateKeepMode } from "../settings/settings";
import { formatSize } from "../utils/format";
import {
	buildFixDecisionState,
	type FixDecision,
	resolveDecisionAction,
} from "./fix-decisions";
```

- [ ] **Step 2: Add the pure policy-view helpers after `shouldAskForKeep`**

Insert after the `shouldAskForKeep` function (after its closing `}`, before
`class ConfirmFixModal`):

```typescript
/**
 * One eligibility view shared by the confirmation model, the modal
 * controls, the report rows, and the bulk-selection gate. A missing field
 * (hand-built issue) degrades to review-required: fixable only through an
 * explicit per-item decision, never silently.
 */
export function resolveEligibility(issue: Issue): FixEligibility {
	return issue.eligibility ?? "review-required";
}

export type EligibilityExplanation = { status: string; reason: string };

/**
 * Sentence-case status and reason for the modal and the report row. The
 * status ALWAYS derives from `resolveEligibility` so the tier and its
 * explanation can never disagree; the reason picks the first matching
 * condition.
 */
export function describeEligibility(
	issue: Issue,
): EligibilityExplanation {
	const action = issue.fixAction;
	if (!action) {
		return { status: "No fix action", reason: "This finding has no fix action." };
	}
	const eligibility = resolveEligibility(issue);
	const status = eligibility === "blocked"
		? "Blocked"
		: eligibility === "review-required"
			? "Review required"
			: "Eligible";
	let reason: string;
	if (issue.classification === "unverified") {
		reason = "The finding is unverified, so its fix cannot run.";
	} else if (
		action.kind === "trash-file"
		&& issue.impact?.coverageComplete === false
	) {
		reason =
			"Reference coverage is incomplete, so files cannot be moved to trash safely.";
	} else if (action.selection?.requiresReview === true) {
		reason =
			"Several copies are referenced, so an explicit keep choice is required.";
	} else if (issue.classification !== "confirmed") {
		reason = "The finding needs review before its fix can run.";
	} else if (
		action.kind === "remove-link-text"
		&& (action.original === undefined || action.replacement === undefined)
	) {
		reason = "The replacement text is not fully specified.";
	} else if (eligibility === "blocked") {
		reason = "The finding cannot be fixed in this state.";
	} else {
		reason = eligibility === "review-required"
			? "The finding needs review before its fix can run."
			: "The fix is confirmed and its evidence is complete.";
	}
	return { status, reason };
}

export type EligibilityGroups = {
	eligible: Issue[];
	reviewRequired: Issue[];
	blocked: Issue[];
};

export function groupByEligibility(issues: Issue[]): EligibilityGroups {
	const groups: EligibilityGroups = {
		eligible: [],
		reviewRequired: [],
		blocked: [],
	};
	for (const issue of issues) {
		if (!issue.fixAction) continue;
		const eligibility = resolveEligibility(issue);
		if (eligibility === "eligible") groups.eligible.push(issue);
		else if (eligibility === "blocked") groups.blocked.push(issue);
		else groups.reviewRequired.push(issue);
	}
	return groups;
}

/**
 * Whether a review-required item has its explicit per-item decision:
 * a valid keep choice for duplicate groups (the Milestone 1 radio flow),
 * an approved fingerprint for everything else.
 */
export function isReviewApproved(
	issue: Issue,
	mode: DuplicateKeepMode,
	selectedKeeps: ReadonlyMap<string, string>,
	approvedReviews: ReadonlySet<string>,
): boolean {
	const selection = issue.fixAction?.selection;
	if (selection && shouldAskForKeep(mode, selection)) {
		const keepPath = selectedKeeps.get(issue.fingerprint);
		return keepPath !== undefined
			&& selection.candidatePaths.includes(keepPath);
	}
	return approvedReviews.has(issue.fingerprint);
}

export type ConfirmationPlan = {
	groups: EligibilityGroups;
	/** Eligible issues plus approved review-required issues. */
	actionable: Issue[];
	/** True when at least one action exists and every actionable decision resolves. */
	complete: boolean;
};

export function buildConfirmationPlan(
	issues: Issue[],
	mode: DuplicateKeepMode,
	selectedKeeps: ReadonlyMap<string, string>,
	approvedReviews: ReadonlySet<string>,
): ConfirmationPlan {
	const groups = groupByEligibility(issues);
	const actionable = [
		...groups.eligible,
		...groups.reviewRequired.filter((issue) =>
			isReviewApproved(issue, mode, selectedKeeps, approvedReviews)),
	];
	const state = buildFixDecisionState(actionable, mode, selectedKeeps);
	return {
		groups,
		actionable,
		complete: actionable.length > 0 && state.complete,
	};
}

export type FileStatInfo = { size: number; mtime: number };

export type ImpactRow = {
	path: string;
	size: string;
	mtime: string;
};

/**
 * Impact preview rows for an action's target paths. Paths missing from the
 * stat map render explicit "unknown" text — every target path is always
 * listed, never silently dropped.
 */
export function buildImpactRows(
	paths: string[],
	stats: ReadonlyMap<string, FileStatInfo>,
): ImpactRow[] {
	return paths.map((path) => {
		const stat = stats.get(path);
		return {
			path,
			size: stat ? formatSize(stat.size) : "Size unknown",
			mtime: stat
				? new Date(stat.mtime).toLocaleDateString()
				: "Modified date unknown",
		};
	});
}
```

- [ ] **Step 3: Rework the modal class**

In `class ConfirmFixModal`, add an `approvedReviews` field next to
`selectedKeeps` (line 96):

```typescript
	private selectedKeeps = new Map<string, string>();
	private approvedReviews = new Set<string>();
```

Add a stat collector method after `private finish(...)`:

```typescript
	private collectStats(paths: string[]): Map<string, FileStatInfo> {
		const stats = new Map<string, FileStatInfo>();
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				stats.set(path, { size: file.stat.size, mtime: file.stat.mtime });
			}
		}
		return stats;
	}
```

Replace the whole `renderContent` method (lines 125–204) with:

```typescript
	private renderContent(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("vi-confirm-modal");

		const plan = buildConfirmationPlan(
			this.issues,
			this.mode,
			this.selectedKeeps,
			this.approvedReviews,
		);
		const state = buildFixDecisionState(
			plan.actionable,
			this.mode,
			this.selectedKeeps,
		);
		const actions = plan.actionable.flatMap((issue) => {
			const decision = state.decisions.find(
				(candidate) => candidate.fingerprint === issue.fingerprint,
			);
			if (!decision) return [];
			const action = resolveDecisionAction(issue, decision);
			return action ? [action] : [];
		});
		const summary = summarizeFixActions(actions);

		contentEl.createEl("h3", {
			text: this.issues.length > 1
				? `Confirm batch fix (${this.issues.length} actions)`
				: "Confirm fix",
		});
		contentEl.createEl("p", {
			text: plan.complete
				? summary.description
				: "Approve at least one fix and choose one file to keep in every duplicate group.",
		});

		const stats = this.collectStats([
			...new Set(
				this.issues.flatMap((issue) => issue.fixAction?.targetPaths ?? []),
			),
		]);

		for (const issue of this.issues) {
			this.renderImpactCard(contentEl, issue, stats);
		}

		const btnRow = contentEl.createDiv({ cls: "vi-confirm-buttons" });
		btnRow.createEl("button", { text: "Cancel" })
			.addEventListener("click", () => this.finish(null));
		const confirmBtn = btnRow.createEl("button", {
			cls: "vi-confirm-destructive",
			text: "Confirm",
		});
		confirmBtn.disabled = !plan.complete;
		confirmBtn.addEventListener("click", () => {
			if (plan.complete) this.finish(state.decisions);
		});
	}

	private renderImpactCard(
		container: HTMLElement,
		issue: Issue,
		stats: ReadonlyMap<string, FileStatInfo>,
	): void {
		const action = issue.fixAction;
		if (!action) return;
		const eligibility = resolveEligibility(issue);
		const explanation = describeEligibility(issue);
		const approved = eligibility === "eligible"
			|| isReviewApproved(
				issue,
				this.mode,
				this.selectedKeeps,
				this.approvedReviews,
			);

		const card = container.createDiv({
			cls: eligibility === "review-required" && !approved
				? "vi-impact-card vi-impact-card-muted"
				: "vi-impact-card",
		});
		const titleRow = card.createDiv({ cls: "vi-impact-card-title-row" });
		titleRow.createSpan({ cls: "vi-impact-card-title", text: issue.title });
		titleRow.createSpan({
			cls: `vi-eligibility-badge vi-eligibility-${eligibility}`,
			text: explanation.status,
		});
		card.createDiv({ cls: "vi-impact-reason", text: explanation.reason });

		const rows = card.createDiv({ cls: "vi-impact-rows" });
		for (const row of buildImpactRows(action.targetPaths, stats)) {
			const rowEl = rows.createDiv({ cls: "vi-impact-row" });
			rowEl.createSpan({
				cls: "vi-impact-row-path",
				text: row.path,
			});
			rowEl.createSpan({
				cls: "vi-impact-row-meta",
				text: `${row.size} · modified ${row.mtime}`,
			});
		}

		if (issue.impact) {
			card.createDiv({
				cls: "vi-impact-coverage",
				text: `Inbound references: ${issue.impact.inboundReferences} · Reference coverage: ${issue.impact.coverageComplete ? "complete" : "incomplete"}`,
			});
		}

		const selection = action.selection;
		if (selection) {
			const keepPath = this.selectedKeeps.get(issue.fingerprint)
				?? selection.automaticKeepPath;
			card.createDiv({ cls: "vi-impact-keep", text: `Keep: ${keepPath}` });
		}

		if (selection && shouldAskForKeep(this.mode, selection)) {
			const group = card.createDiv({ cls: "vi-keep-group" });
			group.createDiv({
				cls: "vi-keep-group-title",
				text: "Choose one file to keep",
			});
			const referencedPaths = selection.referencedPaths ?? [];
			if (referencedPaths.length >= 2) {
				group.createDiv({
					cls: "vi-keep-group-impact",
					text: `${referencedPaths.length} of ${selection.candidatePaths.length} files are referenced by notes: ${referencedPaths.join(", ")}. Choose which location to keep — references are never rewritten.`,
				});
			}
			for (const path of selection.candidatePaths) {
				const option = group.createEl("label", { cls: "vi-keep-option" });
				const radio = option.createEl("input", { type: "radio" });
				radio.name = `keep-${issue.fingerprint}`;
				radio.checked =
					this.selectedKeeps.get(issue.fingerprint) === path;
				radio.addEventListener("change", () => {
					this.selectedKeeps.set(issue.fingerprint, path);
					this.renderContent();
				});
				option.createSpan({ cls: "vi-keep-option-path", text: path });
			}
		}

		if (eligibility === "review-required" && !selection) {
			const label = card.createEl("label", { cls: "vi-review-checkbox" });
			const checkbox = label.createEl("input", { type: "checkbox" });
			checkbox.checked = this.approvedReviews.has(issue.fingerprint);
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					this.approvedReviews.add(issue.fingerprint);
				} else {
					this.approvedReviews.delete(issue.fingerprint);
				}
				this.renderContent();
			});
			label.createSpan({ text: "I reviewed this file" });
		}
	}
```

What changed behaviorally: the old flat `vi-file-list` block is superseded by
the per-item impact cards (paths now appear per action with size, date,
references, coverage, and keep path), and the old keep-group loop moves into
the cards. `shouldAskForKeep`, `summarizeFixActions`,
`createSingleUseResolver`, and the settle-on-close behavior are unchanged.

- [ ] **Step 4: Run the modal tests**

```bash
npm test -- src/tests/confirm-modal.test.ts
```

Expected: PASS (existing 5 tests plus the 9 new ones).

---

### Task 4: Add the report fix row and bulk gate in `src/report/render-issues.ts`

**Files:**
- Modify: `src/report/render-issues.ts`

- [ ] **Step 1: Add the import**

Extend the imports at the top (after
`import { getParentFolder } from "../utils/paths";`, line 7) with:

```typescript
import { describeEligibility, resolveEligibility } from "../fix/confirm-modal";
```

- [ ] **Step 2: Add the `selectBulkFixable` gate**

Insert after the `IssueListConfig` type (after its closing `};`, before
`export function renderIssueList`):

```typescript
export type BulkFixSelection = {
	/** Only eligibility === "eligible" issues may enter a one-click batch. */
	bulk: Issue[];
	reviewRequired: number;
	blocked: number;
};

export function selectBulkFixable(selected: Issue[]): BulkFixSelection {
	const bulk: Issue[] = [];
	let reviewRequired = 0;
	let blocked = 0;
	for (const issue of selected) {
		if (!issue.fixAction) continue;
		const eligibility = resolveEligibility(issue);
		if (eligibility === "eligible") bulk.push(issue);
		else if (eligibility === "blocked") blocked += 1;
		else reviewRequired += 1;
	}
	return { bulk, reviewRequired, blocked };
}
```

- [ ] **Step 3: Render the fix status row and reason**

In `renderIssueDetails`, after the `for (const row of getIssueDetailRows(issue))`
loop and before `renderFindingEvidence(details, issue);` (line 119), insert:

```typescript
	if (issue.fixAction) {
		details.createDiv({
			cls: "vi-issue-fix-reason",
			text: describeEligibility(issue).reason,
		});
	}
```

In `getIssueDetailRows`, before the final `return rows;` (line 305), insert:

```typescript
	if (issue.fixAction) {
		const eligibility = resolveEligibility(issue);
		rows.push({
			label: "Fix",
			items: [{
				text: describeEligibility(issue).status,
				className: `vi-eligibility-badge vi-eligibility-${eligibility}`,
			}],
		});
	}
```

- [ ] **Step 4: Run the report tests**

```bash
npm test -- src/tests/render-issue-actions.test.ts src/tests/render-evidence.test.ts
```

Expected: PASS. Fixtures without a `fixAction` render no fix row; a fixture
with a `fixAction` but no `eligibility` field gains a `Review required` row
(same conservative default as the modal) — if any strict-shape assertion in
the render suites depends on the previous detail-row count, update it to the
new expected row and report the exact assertion in the PR.

---

### Task 5: Gate the batch fix button in `src/report/InspectorView.ts`

**Files:**
- Modify: `src/report/InspectorView.ts` (documented deviation from the roadmap file list — the batch fix button lives here; the gate logic lives in `render-issues.ts` as listed)

- [ ] **Step 1: Add the import**

Extend the import from `"./render-issues"` (line 10) to:

```typescript
import { renderIssueList, selectBulkFixable } from "./render-issues";
```

- [ ] **Step 2: Switch the button to eligible-only selection**

In `renderMainActionBar`, replace:

```typescript
		const selectedIssues = visibleIssues.filter((i) => this.model.selectedFingerprints.has(i.fingerprint));
		const selectedFixable = selectedIssues.filter((i) => i.fixAction);
```

with:

```typescript
		const selectedIssues = visibleIssues.filter((i) => this.model.selectedFingerprints.has(i.fingerprint));
		const bulkSelection = selectBulkFixable(selectedIssues);
		const selectedFixable = bulkSelection.bulk;
```

Then, directly after the closing `}` of the whole
`if (this.model.enableFixActions && selectedFixable.length > 0) { ... }`
block (so the note also appears when ONLY excluded items are selected and
the fix button itself is hidden), append:

```typescript
		if (this.model.enableFixActions) {
			const excluded = bulkSelection.reviewRequired + bulkSelection.blocked;
			if (excluded > 0) {
				const note = right.createSpan({
					cls: "vi-bulk-excluded-note",
					text: `${excluded} ${excluded === 1 ? "needs" : "need"} review`,
				});
				setTooltip(
					note,
					"Review-required and blocked findings are excluded from this batch. Fix them one at a time.",
				);
			}
		}
```

- [ ] **Step 3: Run the view-adjacent suites**

```bash
npm test -- src/tests/inspector-view-filters.test.ts src/tests/main.test.ts
```

Expected: PASS. `main.ts` passes whatever issues the view hands to
`onFixAllIssues`; the modal independently re-applies the same policy, so a
view-level regression cannot smuggle a blocked action through — the modal
would exclude it from decisions anyway.

---

### Task 6: Add the styles in `styles.css`

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Append the impact-preview block**

Append at the end of the file (after the final
`@media (max-width: 500px)` block closing at line 219):

```css
/* Fix impact preview */
.vi-eligibility-badge { display: inline-flex; align-items: center; flex: 0 0 auto; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; line-height: 1.5; text-transform: uppercase; }
.vi-eligibility-eligible { background: var(--background-modifier-success); color: var(--text-success); }
.vi-eligibility-review-required { background: var(--background-modifier-hover); color: var(--text-warning); }
.vi-eligibility-blocked { background: var(--background-secondary); color: var(--text-error); }
.vi-impact-card { min-width: 0; margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--background-modifier-border); border-radius: 4px; }
.vi-impact-card-muted { opacity: 0.7; }
.vi-impact-card-title-row { display: flex; flex-wrap: wrap; align-items: baseline; }
.vi-impact-card-title-row > * { min-width: 0; margin: 0 8px 4px 0; }
.vi-impact-card-title { font-weight: 600; overflow-wrap: anywhere; }
.vi-impact-reason { margin-top: 4px; color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
.vi-impact-rows { margin-top: 8px; }
.vi-impact-row { display: flex; flex-wrap: wrap; align-items: baseline; min-width: 0; }
.vi-impact-row > * { min-width: 0; margin: 0 8px 4px 0; }
.vi-impact-row-path { font-family: var(--font-monospace); font-size: 12px; overflow-wrap: anywhere; }
.vi-impact-row-meta { color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
.vi-impact-coverage { margin-top: 4px; color: var(--text-muted); font-size: 12px; }
.vi-impact-keep { margin-top: 4px; color: var(--text-normal); font-size: 12px; overflow-wrap: anywhere; }
.vi-review-checkbox { display: flex; align-items: flex-start; margin-top: 6px; }
.vi-review-checkbox input { margin: 2px 8px 0 0; }
.vi-issue-fix-reason { color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
.vi-bulk-excluded-note { color: var(--text-faint); font-size: 12px; }
```

(The old `.vi-file-list` / `.vi-file-list-item` rules at lines 200–201 become
dead with the modal rework — remove those two lines.)

- [ ] **Step 2: Extend the FIRST 500px media block**

Inside the first `@media (max-width: 500px)` block (the one containing
`.vi-stats`, lines 178–190), after the `.vi-explanation-value` rule, append:

```css
	.vi-impact-row { flex-direction: column; }
	.vi-impact-row > * { margin: 0 0 2px; }
	.vi-impact-card-title-row { flex-direction: column; }
	.vi-bulk-excluded-note { overflow-wrap: anywhere; }
```

- [ ] **Step 3: Run the styles tests**

```bash
npm test -- src/tests/styles.test.ts
```

Expected: PASS, including the pre-existing no-`gap` and `var(--…)`
background checks.

---

### Task 7: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/confirm-modal.test.ts src/tests/render-issue-actions.test.ts src/tests/styles.test.ts
```

Expected: PASS — the confirmation model and the rendered controls enforce
the same policy.

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0, zero ESLint warnings (sentence-case UI strings; no
`obsidianmd/*` rule disabled; `innerHTML` unused; `styles.css` gap-free).

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/fix/confirm-modal.ts`, `src/report/render-issues.ts`,
`src/report/InspectorView.ts`, `styles.css`,
`src/tests/confirm-modal.test.ts`,
`src/tests/render-issue-actions.test.ts`, and
`src/tests/styles.test.ts`. NOT `src/fix/fix-decisions.ts`,
`src/fix/fix-runner.ts`, `src/fix/fix-executor.ts`,
`src/fix/action-policy.ts`, any scanner, `src/settings/*`,
`src/snapshot/*`, `cli/*`, or any fixture file.

- [ ] **Step 4: Commit and push**

```bash
git add src/fix/confirm-modal.ts src/report/render-issues.ts src/report/InspectorView.ts styles.css src/tests/confirm-modal.test.ts src/tests/render-issue-actions.test.ts src/tests/styles.test.ts
git commit -m "feat: preview fix impact before confirmation"
git push -u origin feat/fix-impact-preview
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `feat: preview fix impact before confirmation`, covering: per-item impact
  cards in the confirm modal (paths, size, mtime, inbound references,
  coverage completeness, retained duplicate path); tiered confirmation
  (blocked renders the reason with no confirm control; review-required needs
  an explicit per-item decision — keep choice for duplicate groups, `I
  reviewed this file` checkbox otherwise; eligible included by default);
  bulk fix button restricted to `eligibility === "eligible"` via
  `selectBulkFixable` with a visible "N need review" note; report `Fix`
  status row plus reason line; one shared `resolveEligibility` /
  `describeEligibility` derivation for model, modal, report, and gate;
  `InspectorView.ts` modification documented as a roadmap file-list
  deviation; M1 `shouldAskForKeep` flow preserved (keep choice doubles as
  the review decision); focused tests plus full gates run; no CLI, scanner,
  settings, snapshot, or fingerprint changes (Tasks 2.1/2.3 own those).

## Self-review checklist (completed during plan writing)

- Roadmap Task 2.2 "must show" list ↔ implementation: file paths/size/mtime ✓ (Task 3 `buildImpactRows` + `collectStats` via `TFile.stat`, explicit unknowns for missing stats); known inbound references ✓ (`issue.impact.inboundReferences` line, Task 3 card); coverage completeness ✓ (same line); retained duplicate path ✓ (`Keep: <path>` line, live-updating from `selectedKeeps ?? automaticKeepPath`); note modifications vs trash ✓ (existing `summarizeFixActions` header plus per-card action descriptions); why review/blocked ✓ (`describeEligibility` reason line in both modal and report).
- Roadmap checkboxes: bulk selection never silently includes destructive candidates ✓ (Task 4 `selectBulkFixable` gate + Task 5 wiring + visible "N need review" note; modal independently re-applies the same policy); review-required needs explicit per-item decision ✓ (`isReviewApproved`: keep choice or `approvedReviews` fingerprint; Confirm disabled unless `plan.complete`); blocked renders reason, no confirm control ✓ (blocked cards have no checkbox/radio participation and are never actionable — test-pinned); narrow layouts readable ✓ (Task 6: `flex-wrap`, `min-width: 0`, `overflow-wrap: anywhere`, 500px column stacking, pinned by the new styles test); same policy for model and controls ✓ (single `resolveEligibility`/`describeEligibility` consumed by modal, report, and gate).
- M1 `shouldAskForKeep` integration: function unchanged; radio groups still render for `requiresReview` groups and always-ask mode; the keep choice now doubles as the review approval (`isReviewApproved`), and `buildFixDecisionState` still refuses incomplete keep choices — coherent, not replaced (test-pinned in both old and new cases).
- Roadmap focused-verification command reproduced in Task 7 Step 1 with the roadmap's expected outcome.
- Deviation documented: `src/report/InspectorView.ts` is modified (not on the roadmap file list) because the batch fix button lives there (lines 474–495); the policy logic lives in `render-issues.ts` as listed. Second deviation: the old flat `vi-file-list` modal block is removed (superseded by impact cards) along with its dead CSS.
- No placeholders: Tasks 3, 4, 5, 6 quote exact current code before replacement (verified against `src/fix/confirm-modal.ts` lines 1–8/96/125–204, `src/report/render-issues.ts` lines 1–22/119/305, `src/report/InspectorView.ts` lines 10/453–495, `styles.css` lines 178–190/200–201/219); Tasks 2's test additions are complete file-ready code.
- Type/name consistency verified: `FixEligibility` and `FixImpact` field names match `src/scanner/Issue.ts`; `formatSize` matches `src/utils/format.ts` (`formatSize(2048) === "2.0 KB"` used in the test); `buildFixDecisionState`/`resolveDecisionAction`/`FixDecision` match `src/fix/fix-decisions.ts`; `TFile.stat` shape `{ size, mtime }` matches Obsidian's API; `setTooltip` is already imported in `InspectorView.ts`; `shouldAskForKeep(mode, selection)` signature unchanged.
- obsidianmd lint constraints: all new UI strings sentence-case ("Review required", "I reviewed this file", "Size unknown", reason sentences); badges use CSS `text-transform: uppercase` on sentence-case text (existing `.vi-severity-badge` pattern); no `innerHTML`, no `eslint-disable`, CSS uses only `var(--…)` colors and no `gap` property (all three pinned by `src/tests/styles.test.ts`).
- Precision-suite/CLI impact: none — no scanner, `ScanRunner`, `cli/*`, snapshot, or fingerprint changes; the modal and report only read fields Task 2.1 already annotates; the full-suite gate in Task 7 Step 2 is the safety net.
