# Changes-First Summary Implementation Plan (Milestone 3, Task 3.2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scan changes the primary report summary. `renderSummary` (`src/report/render-summary.ts`) renders a `What changed` panel first — new confirmed error and warning counts (computed by a new pure helper `countNewConfirmedFindings` in `src/report/report-model.ts`: status `new` AND classification `confirmed`, split by severity), persisting and resolved counts from the last compatible scan, a `Compared with the scan from <time>` meta line, and a `Review new findings (N)` button — before the aggregate `Active` stat and the unchanged meta row. `LifecycleComparison` (`src/scanner/result-diff.ts`) gains an optional `previousScanAt?: number` set to the baseline snapshot's `createdAt` whenever a snapshot exists (available, `settings-changed`, `semantics-changed`; absent on first scan), so the summary can show the previous successful scan time and, when comparison is unavailable, append `(previous successful scan: <time>)` to the existing reason note. The review button is a composed preset over the EXISTING filter model in `InspectorView` (`filterStatus = "new"`, `filterClassification = "confirmed"`, `filterSeverity = null`; clicking again releases) — toolbar chips keep showing the active state and every other result remains reachable, so nothing is silently hidden. Ignored-in-lifecycle and resolved-read-only semantics are untouched. No scanner, fingerprint, `COMPARISON_VERSION`, snapshot, history, settings, fix, or CLI change.

**Architecture:** The time lives on `LifecycleComparison` because the comparison is the object that describes "compared against what"; `compareScanResult` is its only producer and already receives the snapshot. The confirmed-new counting lives in `report-model.ts` next to the other pure finding-view helpers. Summary ordering lives entirely in `render-summary.ts` (the view's `render()` already calls it before outcomes, issues, resolved, and ignored sections). The review preset lives in `InspectorView` because that is where filter state lives; `renderSummary` only emits the callback.

**Tech Stack:** TypeScript, Vitest, FakeElement DOM doubles

Design doc: `docs/superpowers/specs/2026-09-01-changes-first-summary-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 3, Task 3.2)

---

## Ground rules

- Branch: `feat/changes-first-summary`, cut from latest `main`.
- One commit: `feat: prioritize changes in scan summaries`.
- New confirmed headline counts = status `new` + classification `confirmed` + severity `error`/`warning`, over ACTIVE issues only. Candidate/unverified new findings are never in the headline and remain reachable via toolbar chips.
- The review control composes existing filters (`filterStatus`, `filterClassification`, clears `filterSeverity`); it must NOT introduce a separate display mode or hide the toolbar. Toggling off restores the full list.
- Unavailable comparisons claim no lifecycle facts: no New/Persisting/Resolved stats, ever (unchanged semantics).
- `previousScanAt` is optional and informational only — no change to `statuses`, `resolvedIssues`, fingerprints, `COMPARISON_VERSION`, or snapshot/history shapes.
- Do not modify `src/report/render-changes.ts`, `src/report/render-issues.ts`, `src/report/render-outcomes.ts`, `src/scanner/scanners/*`, `src/snapshot/*`, `src/settings/*`, `src/fix/*`, `src/main.ts`, or `cli/*`.
- Deviation from the roadmap file list: `src/scanner/result-diff.ts` + `src/tests/result-diff.test.ts` ARE modified (previous-scan-time carrier), and `src/tests/main.test.ts` IS modified (four pinned `view.setResult` assertions gain `previousScanAt: 100`); `src/report/render-changes.ts` and its tests are NOT modified (the resolved section is already read-only and needs nothing).
- Never `eslint-disable` any `obsidianmd/*` rule. No `innerHTML`; use `createEl`/`createDiv`/`createSpan`.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/changes-first-summary
```

---

### Task 2: Write the failing tests first (TDD)

**Files:**
- Modify: `src/tests/render-summary.test.ts`
- Modify: `src/tests/result-diff.test.ts`
- Modify: `src/tests/inspector-view-filters.test.ts`
- Modify: `src/tests/main.test.ts`

- [ ] **Step 1: Replace `src/tests/render-summary.test.ts` in full**

```typescript
import { describe, expect, it, vi } from "vitest";
import type { Issue, ScanResult } from "../scanner/Issue";
import type { LifecycleComparison } from "../scanner/result-diff";
import type { SnapshotIssue } from "../snapshot/scan-snapshot";
import { renderSummary } from "../report/render-summary";

type Listener = () => void;

class FakeElement {
	children: FakeElement[] = [];
	text: string | null;
	cls: string;
	tag: string;
	attr: Record<string, string>;
	private listeners = new Map<string, Listener>();

	constructor(
		tag = "div",
		options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	) {
		this.text = options.text ?? null;
		this.cls = options.cls ?? "";
		this.tag = tag;
		this.attr = options.attr ?? {};
	}

	createDiv(
		options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	): FakeElement {
		return this.addChild("div", options);
	}

	createSpan(
		options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	): FakeElement {
		return this.addChild("span", options);
	}

	createEl(
		tag: string,
		options: { text?: string; cls?: string; attr?: Record<string, string> } = {},
	): FakeElement {
		return this.addChild(tag, options);
	}

	addClass(cls: string): void {
		this.cls = `${this.cls} ${cls}`.trim();
	}

	addEventListener(event: string, listener: Listener): void {
		this.listeners.set(event, listener);
	}

	click(): void {
		this.listeners.get("click")?.();
	}

	private addChild(
		tag: string,
		options: { text?: string; cls?: string; attr?: Record<string, string> },
	): FakeElement {
		const child = new FakeElement(tag, options);
		this.children.push(child);
		return child;
	}
}

function flatten(element: FakeElement): string {
	return `${element.text ?? ""}${element.children.map(flatten).join("")}`;
}

function findByText(element: FakeElement, text: string): FakeElement | undefined {
	if (flatten(element) === text) return element;
	for (const child of element.children) {
		const match = findByText(child, text);
		if (match) return match;
	}
	return undefined;
}

function snapshotIssue(fingerprint: string, ignored: boolean): SnapshotIssue {
	return {
		fingerprint,
		scannerId: "broken-links",
		severity: "error",
		classification: "confirmed",
		title: fingerprint,
		message: fingerprint,
		relatedPaths: [],
		evidence: {},
		explanation: { why: "why", nextStep: "next" },
		ignored,
	};
}

function activeIssue(
	fingerprint: string,
	severity: Issue["severity"] = "error",
	classification: Issue["classification"] = "confirmed",
): Issue {
	return {
		scannerId: "broken-links",
		severity,
		classification,
		title: fingerprint,
		message: fingerprint,
		relatedPaths: [],
		evidence: {},
		explanation: { why: "why", nextStep: "next" },
		fingerprint,
	};
}

const result: ScanResult = {
	startedAt: 0,
	finishedAt: 1000,
	issues: [
		activeIssue("new-error"),
		activeIssue("new-warning", "warning"),
		activeIssue("new-candidate", "error", "candidate"),
		activeIssue("persisting-a"),
		activeIssue("persisting-b"),
	],
	ignoredIssues: [
		activeIssue("ignored-a"),
		activeIssue("ignored-b"),
	],
	filesScanned: 8,
	scannersRun: ["broken-links", "empty-notes"],
};

function availableComparison(): LifecycleComparison {
	return {
		available: true,
		previousScanAt: 1_000,
		statuses: new Map([
			["new-error", "new"],
			["new-warning", "new"],
			["new-candidate", "new"],
			["persisting-a", "persisting"],
			["persisting-b", "persisting"],
		]),
		resolvedIssues: [
			snapshotIssue("resolved-active", false),
			snapshotIssue("resolved-ignored", true),
		],
	};
}

describe("renderSummary", () => {
	it("leads with new confirmed errors and warnings before aggregate totals", () => {
		const container = new FakeElement();
		const onFilterStatus = vi.fn();
		const onReviewNewFindings = vi.fn();

		renderSummary(container as unknown as HTMLElement, result, {
			comparison: availableComparison(),
			onFilterStatus,
			onReviewNewFindings,
		});

		const text = flatten(container);
		expect(text).toContain("What changed");
		expect(text).toContain("Compared with the scan from");
		expect(text).toContain("New errors1New warnings1Persisting2Resolved1");
		expect(text).toContain("Active5");
		expect(text).toContain("8 files scanned1.0s2 scannersIgnored 2");
		expect(text.indexOf("New errors1")).toBeGreaterThan(0);
		expect(text.indexOf("New errors1")).toBeLessThan(text.indexOf("Active5"));
	});

	it("counts only confirmed new findings in the headline", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: availableComparison(),
		});

		const text = flatten(container);
		expect(text).toContain("New errors1");
		expect(text).toContain("New warnings1");
		expect(text).not.toContain("New errors2");
		expect(text).not.toContain("New warnings2");
	});

	it("keeps persisting as the only summary status-filter button", () => {
		const container = new FakeElement();
		const onFilterStatus = vi.fn();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: availableComparison(),
			onFilterStatus,
		});

		const newErrors = findByText(container, "New errors1");
		const newWarnings = findByText(container, "New warnings1");
		const persisting = findByText(container, "Persisting2");
		const resolved = findByText(container, "Resolved1");
		expect(newErrors?.tag).toBe("div");
		expect(newWarnings?.tag).toBe("div");
		expect(persisting?.tag).toBe("button");
		expect(persisting?.attr).toEqual({ type: "button" });
		expect(persisting?.cls).toContain("vi-stat-persisting");
		expect(resolved?.tag).toBe("div");

		persisting?.click();
		expect(onFilterStatus.mock.calls).toEqual([["persisting"]]);
	});

	it("offers a review control reporting the new confirmed count", () => {
		const container = new FakeElement();
		const onReviewNewFindings = vi.fn();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: availableComparison(),
			onReviewNewFindings,
		});

		const button = findByText(container, "Review new findings (2)");
		expect(button?.tag).toBe("button");
		expect(button?.attr).toEqual({ type: "button" });
		expect(button?.cls).toContain("vi-review-new-btn");

		button?.click();
		expect(onReviewNewFindings).toHaveBeenCalledTimes(1);
	});

	it("omits the review control without new confirmed findings or a callback", () => {
		const persistingOnly = { ...result, issues: [activeIssue("persisting-a")] };

		const noNewConfirmed = new FakeElement();
		renderSummary(noNewConfirmed as unknown as HTMLElement, persistingOnly, {
			comparison: {
				...availableComparison(),
				statuses: new Map([["persisting-a", "persisting"]]),
			},
			onReviewNewFindings: vi.fn(),
		});
		expect(flatten(noNewConfirmed)).not.toContain("Review new findings");

		const noCallback = new FakeElement();
		renderSummary(noCallback as unknown as HTMLElement, result, {
			comparison: availableComparison(),
		});
		expect(flatten(noCallback)).not.toContain("Review new findings");
	});

	it("shows the previous scan time next to each unavailable reason", () => {
		for (const reason of [
			"first-scan",
			"settings-changed",
			"semantics-changed",
		] as const) {
			const container = new FakeElement();
			renderSummary(container as unknown as HTMLElement, result, {
				comparison: {
					available: false,
					reason,
					previousScanAt: 1_000,
					statuses: new Map(),
					resolvedIssues: [],
				},
			});

			const text = flatten(container);
			expect(text).toContain("previous successful scan:");
			if (reason === "settings-changed") {
				expect(text).toContain("Scan settings changed; this scan starts a new comparison baseline");
			} else if (reason === "semantics-changed") {
				expect(text).toContain("Scanner behavior changed; this scan starts a new comparison baseline");
			} else {
				expect(text).toContain("No previous successful scan for these settings");
			}
		}
	});

	it("renders no time and no lifecycle stats for a first scan", () => {
		const container = new FakeElement();
		renderSummary(container as unknown as HTMLElement, result, {
			comparison: {
				available: false,
				reason: "first-scan",
				statuses: new Map(),
				resolvedIssues: [],
			},
		});

		const text = flatten(container);
		expect(text).toContain("No previous successful scan for these settings");
		expect(text).not.toContain("previous successful scan:");
		expect(text).not.toContain("New errors");
		expect(text).not.toContain("New warnings");
		expect(text).not.toContain("Persisting");
		expect(text).not.toContain("Resolved");
		expect(text).not.toContain("Compared with the scan from");
		expect(text).toContain("Active5");
	});
});
```

- [ ] **Step 2: Update `src/tests/result-diff.test.ts`**

In "rejects changed comparison semantics before checking settings" (lines 64–69),
replace:

```typescript
		expect(compareScanResult(makeResult([]), snapshot, "new-profile")).toEqual({
			available: false,
			reason: "semantics-changed",
			statuses: new Map(),
			resolvedIssues: [],
		});
```

with:

```typescript
		expect(compareScanResult(makeResult([]), snapshot, "new-profile")).toEqual({
			available: false,
			reason: "semantics-changed",
			previousScanAt: 1,
			statuses: new Map(),
			resolvedIssues: [],
		});
```

In "rejects changed detection settings" (lines 75–80), replace:

```typescript
		expect(compareScanResult(makeResult([]), snapshot, "new-profile")).toEqual({
			available: false,
			reason: "settings-changed",
			statuses: new Map(),
			resolvedIssues: [],
		});
```

with:

```typescript
		expect(compareScanResult(makeResult([]), snapshot, "new-profile")).toEqual({
			available: false,
			reason: "settings-changed",
			previousScanAt: 1,
			statuses: new Map(),
			resolvedIssues: [],
		});
```

In "classifies active and ignored findings and resolves missing findings"
(lines 95–96), replace:

```typescript
		expect(result.available).toBe(true);
		expect(result.reason).toBeUndefined();
```

with:

```typescript
		expect(result.available).toBe(true);
		expect(result.reason).toBeUndefined();
		expect(result.previousScanAt).toBe(1);
```

Then append this test immediately after "reports the first scan without
lifecycle claims":

```typescript
	it("carries the baseline scan time whenever a snapshot exists", () => {
		const snapshot = makeSnapshot([makeIssue("previous")], [], "old-profile");

		const settingsChanged = compareScanResult(makeResult([]), snapshot, "new-profile");
		expect(settingsChanged.available).toBe(false);
		expect(settingsChanged.previousScanAt).toBe(1);

		const semanticsSnapshot = {
			...snapshot,
			comparisonVersion: COMPARISON_VERSION + 1,
		} as ScanSnapshot;
		const semanticsChanged = compareScanResult(makeResult([]), semanticsSnapshot, "old-profile");
		expect(semanticsChanged.available).toBe(false);
		expect(semanticsChanged.previousScanAt).toBe(1);
	});
```

(The `makeSnapshot` helper creates snapshots with `createdAt = 1`; `first-scan`
keeps its existing exact-equality expectation because a null snapshot adds no
`previousScanAt` key.)

- [ ] **Step 3: Update `src/tests/inspector-view-filters.test.ts`**

In "passes the global comparison to summary and filtered issues only to the
issue list" (lines 227–231), replace:

```typescript
		const summaryOptions = renderSummaryMock.mock.lastCall?.[2];
		expect.soft(summaryOptions).toEqual({
			comparison: (view as any).model.comparison,
			onFilterStatus: expect.any(Function),
		});
```

with:

```typescript
		const summaryOptions = renderSummaryMock.mock.lastCall?.[2];
		expect.soft(summaryOptions).toEqual({
			comparison: (view as any).model.comparison,
			onFilterStatus: expect.any(Function),
			onReviewNewFindings: expect.any(Function),
		});
```

Then append this test immediately after "toggles lifecycle filtering from the
summary headline":

```typescript
	it("applies and releases the review-new preset without hiding other results", () => {
		const container = new FakeElement();
		const view = new InspectorView(new WorkspaceLeaf());
		(view as any).containerEl.children[1] = container;
		const newError = makeIssue("broken-links", "error", "new-confirmed");
		const newCandidate = makeIssue("broken-links", "error", "new-candidate", "candidate");
		const persisting = makeIssue("duplicate-files", "warning", "persisting-confirmed");
		(view as any).model.result = {
			...result,
			issues: [newError, newCandidate, persisting],
		};
		(view as any).model.comparison = comparable([
			["new-confirmed", "new"],
			["new-candidate", "new"],
			["persisting-confirmed", "persisting"],
		]);
		(view as any).model.filterSeverity = "warning";

		(view as any).render();
		renderSummaryMock.mock.lastCall?.[2].onReviewNewFindings();

		expect((view as any).model.filterStatus).toBe("new");
		expect((view as any).model.filterClassification).toBe("confirmed");
		expect((view as any).model.filterSeverity).toBeNull();
		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [newError] }),
		);

		renderSummaryMock.mock.lastCall?.[2].onReviewNewFindings();

		expect((view as any).model.filterStatus).toBeNull();
		expect((view as any).model.filterClassification).toBeNull();
		expect(renderIssueListMock).toHaveBeenLastCalledWith(
			expect.any(FakeElement),
			expect.objectContaining({ issues: [newError, persisting, newCandidate] }),
		);
	});
```

(The unfiltered order is `compareIssues`'s existing ranking: new confirmed
error rank 0, non-new rank 3, candidate rank 4.)

- [ ] **Step 4: Update the four pinned `view.setResult` assertions in `src/tests/main.test.ts`**

Every fixture snapshot in these tests is created with `createdAt = 100`, so the
comparison now carries `previousScanAt: 100` on these paths. In each of the four
tests below, add `previousScanAt: 100,` as the third property of the expected
object (after `available`/`reason`, before `statuses`):

1. "compares against a compatible snapshot and replaces the accepted baseline" —
   the expected object becomes:

```typescript
		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: true,
			previousScanAt: 100,
			statuses: new Map([
				["persisting", "persisting"],
				["new", "new"],
			]),
			resolvedIssues: [expect.objectContaining({ fingerprint: "resolved" })],
		});
```

2. "does not label findings new when detection settings changed" — the expected
   object becomes:

```typescript
		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: false,
			reason: "settings-changed",
			previousScanAt: 100,
			statuses: new Map(),
			resolvedIssues: [],
		});
```

3. "reports incompatible stored comparison semantics before replacing the
   baseline" — the expected object becomes:

```typescript
		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: false,
			reason: "semantics-changed",
			previousScanAt: 100,
			statuses: new Map(),
			resolvedIssues: [],
		});
```

4. "keeps a completed result visible, rolls back a failed snapshot save, and
   recovers" — the expected object becomes:

```typescript
		expect(view.setResult).toHaveBeenCalledWith(result, {
			available: true,
			previousScanAt: 100,
			statuses: new Map([["current", "new"]]),
			resolvedIssues: [expect.objectContaining({ fingerprint: "previous" })],
		});
```

The first-scan assertion ("accepts and persists a first completed scan without
lifecycle statuses") is NOT changed: a null snapshot produces no
`previousScanAt` key, so the existing exact expectation still holds.

- [ ] **Step 5: Run and confirm failure**

```bash
npm test -- src/tests/render-summary.test.ts src/tests/result-diff.test.ts src/tests/inspector-view-filters.test.ts
```

Expected: FAIL — `countNewConfirmedFindings` does not exist (unresolvable
import in `render-summary.ts` — if TypeScript fails to compile the import the
suite errors; that is the expected red), the changes-first ordering /
review-control / previous-time expectations fail against the current summary,
`previousScanAt` is `undefined` in the result-diff expectations, and
`onReviewNewFindings` is `undefined` in the view test (TypeError on call).
`src/tests/main.test.ts` still passes at this point (Task 3 makes it accurate).

---

### Task 3: Carry the baseline time in `src/scanner/result-diff.ts`

**Files:**
- Modify: `src/scanner/result-diff.ts`

- [ ] **Step 1: Add the field and set it on every snapshot-bearing branch**

Replace the type (lines 15–20):

```typescript
export type LifecycleComparison = {
	available: boolean;
	reason?: ComparisonUnavailableReason;
	statuses: Map<string, CurrentFindingStatus>;
	resolvedIssues: SnapshotIssue[];
};
```

with:

```typescript
export type LifecycleComparison = {
	available: boolean;
	reason?: ComparisonUnavailableReason;
	/** When the baseline snapshot was captured; absent when there is no snapshot. */
	previousScanAt?: number;
	statuses: Map<string, CurrentFindingStatus>;
	resolvedIssues: SnapshotIssue[];
};
```

Replace the three early-return guards in `compareScanResult` (lines 27–31):

```typescript
	if (snapshot === null) return unavailable("first-scan");
	if (snapshot.comparisonVersion !== COMPARISON_VERSION) {
		return unavailable("semantics-changed");
	}
	if (snapshot.scanProfile !== currentProfile) return unavailable("settings-changed");
```

with:

```typescript
	if (snapshot === null) return unavailable("first-scan");
	if (snapshot.comparisonVersion !== COMPARISON_VERSION) {
		return { ...unavailable("semantics-changed"), previousScanAt: snapshot.createdAt };
	}
	if (snapshot.scanProfile !== currentProfile) {
		return { ...unavailable("settings-changed"), previousScanAt: snapshot.createdAt };
	}
```

Replace the final return (line 58):

```typescript
	return { available: true, statuses, resolvedIssues };
```

with:

```typescript
	return {
		available: true,
		previousScanAt: snapshot.createdAt,
		statuses,
		resolvedIssues,
	};
```

- [ ] **Step 2: Run the diff tests and main tests**

```bash
npm test -- src/tests/result-diff.test.ts src/tests/main.test.ts
```

Expected: PASS — the new field is informational; statuses and resolved counting
are byte-identical, and the four updated `main.test.ts` assertions now match.

---

### Task 4: Add the confirmed-new counter to `src/report/report-model.ts`

**Files:**
- Modify: `src/report/report-model.ts`

- [ ] **Step 1: Insert the helper after `buildIssueFilterView` (before `compareIssues`)**

```typescript
export function countNewConfirmedFindings(
	issues: Issue[],
	statuses: ReadonlyMap<string, CurrentFindingStatus>,
): { errors: number; warnings: number } {
	let errors = 0;
	let warnings = 0;
	for (const issue of issues) {
		if (statuses.get(issue.fingerprint) !== "new") continue;
		if (issue.classification !== "confirmed") continue;
		if (issue.severity === "error") errors += 1;
		else if (issue.severity === "warning") warnings += 1;
	}
	return { errors, warnings };
}
```

(`Issue`, `CurrentFindingStatus`, and `ReadonlyMap` are already imported or
global; no import changes.)

---

### Task 5: Rewrite `src/report/render-summary.ts` changes-first

**Files:**
- Modify: `src/report/render-summary.ts`

- [ ] **Step 1: Replace the whole file with**

```typescript
import type { ScanResult } from "../scanner/Issue";
import type {
	ComparisonUnavailableReason,
	CurrentFindingStatus,
	LifecycleComparison,
} from "../scanner/result-diff";
import { countNewConfirmedFindings } from "./report-model";
import { formatDuration } from "../utils/format";

export type SummaryOptions = {
	comparison: LifecycleComparison;
	onFilterStatus?: (status: CurrentFindingStatus | null) => void;
	onReviewNewFindings?: () => void;
};

export function renderSummary(container: HTMLElement, result: ScanResult, options: SummaryOptions) {
	const duration = formatDuration(result.finishedAt - result.startedAt);

	const summary = container.createDiv({ cls: "vi-summary" });
	summary.createEl("h2", { text: "Scan results" });

	renderChanges(summary, result, options);

	const stats = summary.createDiv({ cls: "vi-stats" });
	const active = stats.createDiv({ cls: "vi-stat vi-stat-active" });
	active.createSpan({ cls: "vi-stat-label", text: "Active" });
	active.createSpan({ cls: "vi-stat-value", text: String(result.issues.length) });

	const meta = summary.createDiv({ cls: "vi-meta" });
	meta.createSpan({ text: `${result.filesScanned} files scanned` });
	meta.createSpan({ text: duration });
	meta.createSpan({ text: `${result.scannersRun.length} scanners` });
	meta.createSpan({ text: `Ignored ${result.ignoredIssues.length}` });
}

function renderChanges(
	summary: HTMLElement,
	result: ScanResult,
	options: SummaryOptions,
): void {
	const comparison = options.comparison;
	const changes = summary.createDiv({ cls: "vi-changes" });
	changes.createDiv({ cls: "vi-changes-title", text: "What changed" });

	if (!comparison.available) {
		changes.createDiv({
			cls: "vi-comparison-note",
			text: unavailableMessage(
				comparison.reason ?? "first-scan",
				comparison.previousScanAt,
			),
		});
		return;
	}

	changes.createDiv({
		cls: "vi-changes-meta",
		text: comparison.previousScanAt === undefined
			? "Compared with the previous successful scan"
			: `Compared with the scan from ${formatScanTime(comparison.previousScanAt)}`,
	});

	const newConfirmed = countNewConfirmedFindings(result.issues, comparison.statuses);
	const stats = changes.createDiv({ cls: "vi-changes-stats" });
	const items: Array<{
		label: string;
		value: number;
		cls: string;
		status?: CurrentFindingStatus;
	}> = [
		{ label: "New errors", value: newConfirmed.errors, cls: "vi-stat-new vi-stat-error" },
		{ label: "New warnings", value: newConfirmed.warnings, cls: "vi-stat-new vi-stat-warning" },
		{
			label: "Persisting",
			value: countStatus(result, comparison, "persisting"),
			cls: "vi-stat-persisting",
			status: "persisting",
		},
		{
			label: "Resolved",
			value: comparison.resolvedIssues.filter((issue) => !issue.ignored).length,
			cls: "vi-stat-resolved",
		},
	];
	for (const item of items) {
		const status = item.status;
		const onFilterStatus = options.onFilterStatus;
		const isFilter = status !== undefined && onFilterStatus !== undefined;
		const cls = `vi-stat ${item.cls}${isFilter ? " vi-stat-clickable" : ""}`;
		const stat = isFilter
			? stats.createEl("button", { cls, attr: { type: "button" } })
			: stats.createDiv({ cls });
		stat.createSpan({ cls: "vi-stat-label", text: item.label });
		stat.createSpan({ cls: "vi-stat-value", text: String(item.value) });
		if (status !== undefined && onFilterStatus) {
			stat.addEventListener("click", () => onFilterStatus(status));
		}
	}

	const reviewable = newConfirmed.errors + newConfirmed.warnings;
	const onReviewNewFindings = options.onReviewNewFindings;
	if (reviewable > 0 && onReviewNewFindings) {
		const button = changes.createEl("button", {
			cls: "vi-review-new-btn",
			text: `Review new findings (${reviewable})`,
			attr: { type: "button" },
		});
		button.addEventListener("click", () => onReviewNewFindings());
	}
}

function countStatus(
	result: ScanResult,
	comparison: LifecycleComparison,
	status: CurrentFindingStatus,
): number {
	return result.issues.filter(
		(issue) => comparison.statuses.get(issue.fingerprint) === status,
	).length;
}

function unavailableMessage(
	reason: ComparisonUnavailableReason,
	previousScanAt?: number,
): string {
	const base = baseUnavailableMessage(reason);
	if (previousScanAt === undefined) return base;
	return `${base} (previous successful scan: ${formatScanTime(previousScanAt)})`;
}

function baseUnavailableMessage(reason: ComparisonUnavailableReason): string {
	if (reason === "settings-changed") {
		return "Scan settings changed; this scan starts a new comparison baseline";
	}
	if (reason === "semantics-changed") {
		return "Scanner behavior changed; this scan starts a new comparison baseline";
	}
	return "No previous successful scan for these settings";
}

function formatScanTime(ms: number): string {
	return new Date(ms).toLocaleString();
}
```

- [ ] **Step 2: Run the summary tests**

```bash
npm test -- src/tests/render-summary.test.ts
```

Expected: PASS.

---

### Task 6: Wire the review preset in `src/report/InspectorView.ts`

**Files:**
- Modify: `src/report/InspectorView.ts`

- [ ] **Step 1: Extend the summary call**

In `render()` (lines 249–255), replace:

```typescript
		renderSummary(container, this.model.result, {
			comparison: this.model.comparison,
			onFilterStatus: (status) => {
				this.model.filterStatus = this.model.filterStatus === status ? null : status;
				this.render();
			},
		});
```

with:

```typescript
		renderSummary(container, this.model.result, {
			comparison: this.model.comparison,
			onFilterStatus: (status) => {
				this.model.filterStatus = this.model.filterStatus === status ? null : status;
				this.render();
			},
			onReviewNewFindings: () => {
				if (
					this.model.filterStatus === "new"
					&& this.model.filterClassification === "confirmed"
				) {
					this.model.filterStatus = null;
					this.model.filterClassification = null;
				} else {
					this.model.filterStatus = "new";
					this.model.filterClassification = "confirmed";
					this.model.filterSeverity = null;
				}
				this.render();
			},
		});
```

No other view change: `setResult`'s existing stale-filter reset already clears
`filterStatus` / `filterClassification` when the next result cannot satisfy
them, and the toolbar chips already render the active state.

- [ ] **Step 2: Run the view tests**

```bash
npm test -- src/tests/inspector-view-filters.test.ts
```

Expected: PASS — including the pre-existing "toggles lifecycle filtering from
the summary headline" test (it invokes `onFilterStatus` directly) and "hides
lifecycle buttons when comparison is unavailable".

---

### Task 7: Style the changes panel in `styles.css`

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Append at the end of the file**

```css
/* Changes-first summary */
.vi-changes { margin-bottom: 14px; padding: 10px 12px; border: 1px solid var(--background-modifier-border); border-radius: 6px; background: var(--background-secondary); }
.vi-changes-title { margin: 0 0 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
.vi-changes-meta { margin: 0 0 8px; color: var(--text-muted); font-size: 12px; overflow-wrap: anywhere; }
.vi-changes-stats { display: flex; flex-wrap: wrap; margin-bottom: 8px; }
.vi-changes-stats > * { margin: 0 12px 8px 0; }
.vi-changes-stats > *:last-child { margin-right: 0; }
.vi-changes .vi-comparison-note { margin-bottom: 0; }
button.vi-review-new-btn { appearance: none; height: auto; min-height: 0; padding: 6px 12px; border: 1px solid var(--interactive-accent); border-radius: 4px; box-shadow: none; background: var(--interactive-accent); color: var(--text-on-accent); cursor: pointer; font: inherit; font-size: 12px; line-height: normal; }
button.vi-review-new-btn:hover, button.vi-review-new-btn:active { opacity: 0.85; }
button.vi-review-new-btn:focus-visible { outline: 2px solid var(--interactive-accent); outline-offset: 2px; }

@media (max-width: 500px) {
	.vi-changes-stats > * { margin: 0 8px 8px 0; }
}
```

(No `gap` properties — the styles test rejects them; all backgrounds are
`var(--)`.)

- [ ] **Step 2: Run the styles tests**

```bash
npm test -- src/tests/styles.test.ts
```

Expected: PASS.

---

### Task 8: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/render-summary.test.ts src/tests/inspector-view-filters.test.ts src/tests/result-diff.test.ts
```

Expected: PASS — new confirmed findings lead the summary, the review preset
filters without hiding, and lifecycle semantics are unchanged.

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

Expected: only `src/scanner/result-diff.ts`, `src/report/report-model.ts`,
`src/report/render-summary.ts`, `src/report/InspectorView.ts`, `styles.css`,
`src/tests/render-summary.test.ts`, `src/tests/result-diff.test.ts`,
`src/tests/inspector-view-filters.test.ts`, and `src/tests/main.test.ts`. NOT
`src/report/render-changes.ts`, `src/report/render-issues.ts`, `src/main.ts`,
`src/snapshot/*`, `src/settings/*`, `src/fix/*`, or `cli/*`.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/result-diff.ts src/report/report-model.ts src/report/render-summary.ts src/report/InspectorView.ts styles.css src/tests/render-summary.test.ts src/tests/result-diff.test.ts src/tests/inspector-view-filters.test.ts src/tests/main.test.ts
git commit -m "feat: prioritize changes in scan summaries"
git push -u origin feat/changes-first-summary
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `feat: prioritize changes in scan summaries`, covering: a `What changed`
  panel leads the summary with new confirmed error/warning counts (status
  `new` + classification `confirmed`, via `countNewConfirmedFindings`) plus
  persisting and resolved counts from the last compatible scan, before the
  aggregate `Active` stat; `LifecycleComparison.previousScanAt` carries the
  baseline snapshot time (available, settings-changed, and semantics-changed;
  absent on first scan) so the summary shows `Compared with the scan from
  <time>` and appends `(previous successful scan: <time>)` to unavailable
  reasons; a `Review new findings (N)` button applies the existing facet
  filters (`new` + `confirmed`, clearing a stale severity filter) and toggles
  off, so toolbar chips keep every other result reachable; ignored findings
  remain active in lifecycle comparison and resolved entries remain
  historical, read-only, and non-actionable; deviations documented
  (`result-diff.ts`/its tests carry the time, `main.test.ts` pinned
  assertions updated, `render-changes.ts` untouched); no scanner, fingerprint,
  `COMPARISON_VERSION`, snapshot, history, settings, fix, or CLI changes.

## Self-review checklist (completed during plan writing)

- Roadmap Task 3.2 checkbox ↔ implementation mapping: new confirmed errors and warnings before aggregate totals ✓ (Task 5: `renderChanges` is the first child after the h2, before `vi-stats`; DOM-order pinned by the `toBeLessThan(text.indexOf("Active5"))` assertion); persisting and resolved counts from the last compatible scan ✓ (same panel, computed exactly as the current headline does — `countStatus(..., "persisting")` and `resolvedIssues.filter(i => !i.ignored).length`, `render-summary.ts` lines 36–48 today); previous successful scan time and unavailability reason ✓ (Task 3 `previousScanAt` set from `snapshot.createdAt` on every snapshot-bearing branch; Task 5 renders `Compared with the scan from` / appends `(previous successful scan: ...)` to the existing note, whose three messages are byte-identical to the current `unavailableMessage`); `Review new findings` control without silently hiding ✓ (Task 6: composed preset over `filterStatus`/`filterClassification` + clears `filterSeverity`; toolbar chips show `vi-active` state, all chips remain clickable, second click releases — pinned by the inspector-view-filters test's apply/release assertions); ignored findings active in lifecycle comparison ✓ (no change to `compareScanResult` status population for `ignoredIssues`, `src/scanner/result-diff.ts` lines 46–52; existing tests "does not resolve a previously active finding that is now ignored" and "passes the same lifecycle statuses to active and ignored issue lists" keep pinning it); resolved entries historical and non-actionable ✓ (`render-changes.ts` and `renderResolvedSection` untouched; existing render-changes/inspector-view tests keep pinning read-only rendering and exclusion from issue lists).
- Verified against real code: `SummaryOptions`/`onFilterStatus` signature (`render-summary.ts` lines 9–12), `formatDuration` (`src/utils/format.ts`), `countStatus` and message strings copied verbatim from the current file, `makeSnapshot` uses `createdAt = 100` in `main.test.ts` (line 1649) and `createdAt = 1` in `result-diff.test.ts` (line 42), `compareIssues` ranking (`report-model.ts` lines 138–146: candidate 4, non-new 3, new confirmed by severity) drives the expected list order `[newError, persisting, newCandidate]`, `InspectorView.render()` calls `renderSummary` before outcomes/issues/resolved/ignored (lines 249–283), and the summary mock in `inspector-view-filters.test.ts` is replaced wholesale so the new option key only affects the one exact-equality assertion updated in Task 2 Step 3.
- Deviations documented with evidence: `src/scanner/result-diff.ts` + `src/tests/result-diff.test.ts` modified (previous-scan-time carrier — no other path delivers the baseline time to the view); `src/tests/main.test.ts` modified (four `toHaveBeenCalledWith` exact assertions break when the comparison gains a defined `previousScanAt: 100`; the first-scan assertion is untouched because a null snapshot adds no key — vitest equality treats absent and `undefined` identically); `src/report/render-changes.ts` NOT modified (roadmap file list omitted it from Files anyway; it renders the read-only resolved items and needs nothing for a summary-ordering change).
- No placeholders: Task 5 is a complete replacement file; Tasks 2–4, 6, 7 quote exact current code before each replacement; the full `render-summary.test.ts` replacement is file-ready (FakeElement double copied from the current file).
- Type/name consistency: `LifecycleComparison` field addition matches its only producer; `countNewConfirmedFindings` imported from `./report-model` (relative from `src/report/`); `CurrentFindingStatus` import retained for the `items` typing and `countStatus`; test fixtures reuse `makeIssue`/`comparable` helpers with their real signatures (`scannerId, severity, fingerprint, classification?`).
- obsidianmd lint constraints: `render-summary.ts` uses only `createDiv`/`createEl`/`createSpan` (no `innerHTML`, no document globals); `toLocaleString` is a plain `Date` method; `styles.css` adds no `gap` and only `var(--` backgrounds (both pinned by `styles.test.ts`).
- Precision-suite/CLI impact: none — `src/tests/scanner-precision.test.ts` observes scanners (untouched); `cli/` never constructs or renders a `LifecycleComparison` and no stable CLI field moves; `compareScanResult` statuses/resolved output is byte-identical apart from the new informational field.
