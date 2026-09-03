# Community-First Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every 0.7.x scanning, lifecycle, fix-safety, automatic-scan, and CLI capability while reducing the default Obsidian experience to “run a scan, review what changed, fix or ignore.”

**Architecture:** Preserve scanner output, fingerprints, action policy, snapshots, history, and CLI JSON as domain contracts. Add a small presentation vocabulary layer and move dense filter/selection controls behind progressive disclosure, so raw domain states remain testable without becoming mandatory user concepts. Keep the Obsidian plugin as the primary README story and move detailed CLI automation documentation to a dedicated reference page.

**Tech Stack:** TypeScript, Obsidian API, Vitest, CSS, Markdown, ESLint, esbuild.

---

## Scope and invariants

This plan is an information-architecture change, not a feature-removal project.

The following capabilities MUST remain unchanged:

- all eight scanners and their current settings;
- issue `classification`, `eligibility`, lifecycle status, evidence, impact, and deterministic fingerprints;
- reference-coverage fail-closed behavior;
- individual fixes, reviewed fixes, safe batch fixes, preflight rescans, and final verification;
- compatible-scan comparison, bounded scan history, and opt-in automatic stale scans;
- CLI flags, exit codes, JSON schema, comparison metadata, and read-only boundary;
- Markdown export contents and large-report protection.

The implementation MUST NOT:

- add a basic/advanced mode setting;
- fork domain behavior between simple and advanced users;
- change scanner semantics or bump comparison semantics;
- remove filters or make evidence inaccessible;
- add telemetry, onboarding tours, health scores, dashboards, trends, or new scanners;
- change automatic-scan defaults or enable network checks implicitly;
- change CLI protocol fields or package contents.

## User-facing information hierarchy

The finished report view has four layers:

1. **Primary result:** scan completion and the number of new findings that need attention.
2. **Primary action:** review new findings, open one finding, fix it, or ignore it.
3. **Optional controls:** filters, lifecycle/classification facets, and batch selection inside one collapsed “Filter and select” disclosure.
4. **Technical details:** interpretation, caveats, evidence, reference coverage, and impact data inside finding or confirmation disclosures.

Raw model values stay unchanged, but user-facing copy follows this mapping:

| Domain value | Default user-facing copy | Default visibility |
|---|---|---|
| `confirmed` | Confirmed | Expanded finding only |
| `candidate` | Needs review | Expanded finding only |
| `unverified` | Could not verify | Expanded finding only |
| `eligible` | no status badge; show “Fix this issue” | Action only |
| `review-required` | Review before fixing | Expanded finding and confirmation |
| `blocked` | Fix unavailable | Expanded finding only |
| `new` | New | Finding card and summary |
| `persisting` | Previously found | Filter panel and expanded details only |
| `resolved` | Resolved | Summary and existing resolved section |

## File map

### Create

- `src/fix/fix-eligibility.ts` — one fail-closed eligibility resolver and one set of user-facing fix-state explanations.
- `src/report/presentation.ts` — pure mappings from domain states to report labels and visibility decisions.
- `src/report/render-controls.ts` — progressive-disclosure filter and batch-selection controls.
- `src/tests/fix-eligibility.test.ts` — fail-closed eligibility and copy regression coverage.
- `src/tests/report-presentation.test.ts` — classification/lifecycle/fix presentation coverage.
- `src/tests/render-controls.test.ts` — filter disclosure, active-filter count, and callback behavior.
- `src/tests/documentation-boundary.test.ts` — enforce plugin-first README positioning and complete CLI reference linkage.
- `docs/cli.md` — detailed CLI usage, configuration, JSON protocol, baseline, and exit-code reference.

### Modify

- `src/fix/confirm-modal.ts` — consume the shared eligibility module and progressively disclose technical impact details.
- `src/report/InspectorView.ts` — render summary before optional controls and delegate control rendering.
- `src/report/report-model.ts` — persist disclosure state without changing filter semantics.
- `src/report/render-summary.ts` — replace the four-status dashboard with a changes-first primary result and secondary comparison details.
- `src/report/render-issues.ts` — show only actionable card-level signals and use plain-language fix copy.
- `src/report/render-evidence.ts` — translate classification labels and move raw evidence behind “Technical evidence.”
- `src/tests/confirm-modal.test.ts` — update shared-module imports and modal copy assertions.
- `src/tests/inspector-view-filters.test.ts` — verify summary-first order and preserved filter behavior.
- `src/tests/render-summary.test.ts` — lock the simplified summary contract.
- `src/tests/render-issue-actions.test.ts` — lock card-level visibility and fix action copy.
- `src/tests/render-evidence.test.ts` — lock expanded plain-language interpretation.
- `src/tests/styles.test.ts` — lock disclosure, wrapping, focus, and narrow-view behavior.
- `styles.css` — style the new hierarchy without hard-coded colors or unsupported gap properties.
- `README.md` — lead with the Obsidian plugin workflow and link to the optional CLI reference.
- `skills/vault-inspector/SKILL.md` — point automation users to `docs/cli.md` without changing the skill’s read-only behavior.

---

### Task 1: Centralize presentation vocabulary without changing domain contracts

**Files:**
- Create: `src/fix/fix-eligibility.ts`
- Create: `src/report/presentation.ts`
- Create: `src/tests/fix-eligibility.test.ts`
- Create: `src/tests/report-presentation.test.ts`
- Modify: `src/fix/confirm-modal.ts`
- Modify: `src/report/render-issues.ts`
- Modify: `src/tests/confirm-modal.test.ts`

- [ ] **Step 1: Write failing tests for fail-closed eligibility and plain-language copy**

Create `src/tests/fix-eligibility.test.ts` with focused fixtures for all three states:

```ts
import { describe, expect, it } from "vitest";
import type { Issue } from "../scanner/Issue";
import {
	describeEligibility,
	resolveEligibility,
} from "../fix/fix-eligibility";

function issue(overrides: Partial<Issue> = {}): Issue {
	return {
		scannerId: "empty-notes",
		severity: "warning",
		title: "Empty note",
		message: "Empty",
		classification: "confirmed",
		explanation: { why: "Empty", nextStep: "Review" },
		primaryPath: "note.md",
		relatedPaths: [],
		evidence: {},
		fingerprint: "empty-note",
		fixAction: {
			kind: "trash-file",
			label: "Delete",
			description: "Move note.md to trash",
			targetPaths: ["note.md"],
		},
		...overrides,
	};
}

describe("fix eligibility presentation", () => {
	it("fails closed when eligibility metadata is missing", () => {
		expect(resolveEligibility(issue())).toBe("review-required");
		expect(describeEligibility(issue()).status).toBe("Review before fixing");
	});

	it("describes eligible fixes as ready without exposing the enum", () => {
		expect(describeEligibility(issue({ eligibility: "eligible" }))).toEqual({
			status: "Ready to fix",
			reason: "The fix is confirmed and its evidence is complete.",
		});
	});

	it("describes blocked fixes as unavailable", () => {
		const blocked = issue({
			classification: "unverified",
			eligibility: "blocked",
		});
		expect(describeEligibility(blocked)).toEqual({
			status: "Fix unavailable",
			reason: "The finding could not be verified, so its fix cannot run.",
		});
	});
});
```

Create `src/tests/report-presentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Issue } from "../scanner/Issue";
import {
	presentClassification,
	presentFix,
	presentLifecycle,
} from "../report/presentation";

const issue = (eligibility: Issue["eligibility"]): Issue => ({
	scannerId: "empty-notes",
	severity: "warning",
	title: "Empty note",
	message: "Empty",
	classification: "confirmed",
	explanation: { why: "Empty", nextStep: "Review" },
	primaryPath: "note.md",
	relatedPaths: [],
	evidence: {},
	fingerprint: "empty-note",
	fixAction: {
		kind: "trash-file",
		label: "Delete",
		description: "Move note.md to trash",
		targetPaths: ["note.md"],
	},
	...(eligibility ? { eligibility } : {}),
});

describe("report presentation", () => {
	it("uses plain-language classification labels", () => {
		expect(presentClassification("confirmed").label).toBe("Confirmed");
		expect(presentClassification("candidate").label).toBe("Needs review");
		expect(presentClassification("unverified").label).toBe("Could not verify");
	});

	it("shows only new lifecycle state on collapsed cards", () => {
		expect(presentLifecycle("new")).toEqual({
			label: "New",
			className: "vi-status-new",
			showOnCard: true,
		});
		expect(presentLifecycle("persisting").showOnCard).toBe(false);
		expect(presentLifecycle("persisting").label).toBe("Previously found");
	});

	it("uses the action itself instead of an eligible badge", () => {
		expect(presentFix(issue("eligible"))).toMatchObject({
			actionLabel: "Fix this issue",
			stateLabel: null,
		});
		expect(presentFix(issue("review-required"))).toMatchObject({
			actionLabel: "Review fix",
			stateLabel: "Review before fixing",
		});
		expect(presentFix(issue("blocked"))).toMatchObject({
			actionLabel: null,
			stateLabel: "Fix unavailable",
		});
	});
});
```

- [ ] **Step 2: Run the focused tests and verify they fail because the modules do not exist**

Run:

```bash
npm test -- src/tests/fix-eligibility.test.ts src/tests/report-presentation.test.ts
```

Expected: FAIL with module-resolution errors for `fix-eligibility` and `presentation`.

- [ ] **Step 3: Move eligibility resolution into a pure shared module**

Create `src/fix/fix-eligibility.ts` by moving `resolveEligibility`, `EligibilityExplanation`, and `describeEligibility` out of `confirm-modal.ts`. Keep the fail-closed rule and change only user-facing status copy:

```ts
import type { FixEligibility, Issue } from "../scanner/Issue";

export type EligibilityExplanation = { status: string; reason: string };

export function resolveEligibility(issue: Issue): FixEligibility {
	return issue.eligibility ?? "review-required";
}

export function describeEligibility(issue: Issue): EligibilityExplanation {
	const action = issue.fixAction;
	if (!action) {
		return {
			status: "No fix available",
			reason: "This finding has no fix action.",
		};
	}
	const eligibility = resolveEligibility(issue);
	const status = eligibility === "blocked"
		? "Fix unavailable"
		: eligibility === "review-required"
			? "Review before fixing"
			: "Ready to fix";

	let reason: string;
	if (issue.classification === "unverified") {
		reason = "The finding could not be verified, so its fix cannot run.";
	} else if (
		action.kind === "trash-file"
		&& issue.impact?.coverageComplete === false
	) {
		reason = "Some references could not be checked, so files cannot be moved to trash safely.";
	} else if (action.selection?.requiresReview === true) {
		reason = "Several copies are referenced. Choose which location to keep before continuing.";
	} else if (issue.classification !== "confirmed") {
		reason = "Review this finding before allowing its fix to run.";
	} else if (
		action.kind === "remove-link-text"
		&& (action.original === undefined || action.replacement === undefined)
	) {
		reason = "The replacement text is incomplete, so review is required.";
	} else if (eligibility === "blocked") {
		reason = "This fix cannot run in the current state.";
	} else {
		reason = eligibility === "review-required"
			? "Review this finding before allowing its fix to run."
			: "The fix is confirmed and its evidence is complete.";
	}
	return { status, reason };
}
```

Delete the moved definitions from `confirm-modal.ts`, import them from `./fix-eligibility`, and re-export them temporarily so existing imports remain source-compatible during this task:

```ts
import {
	describeEligibility,
	resolveEligibility,
} from "./fix-eligibility";

export {
	describeEligibility,
	resolveEligibility,
} from "./fix-eligibility";
```

Change `render-issues.ts` to import directly from `../fix/fix-eligibility`. Change `confirm-modal.test.ts` to import those functions from the new module. Remove the temporary re-export once no production or test import uses it.

- [ ] **Step 4: Add the report-only presentation mapping**

Create `src/report/presentation.ts`:

```ts
import type {
	FindingClassification,
	Issue,
} from "../scanner/Issue";
import type { CurrentFindingStatus } from "../scanner/result-diff";
import {
	describeEligibility,
	resolveEligibility,
} from "../fix/fix-eligibility";

export type PresentationToken = {
	label: string;
	className: string;
};

export type LifecyclePresentation = PresentationToken & {
	showOnCard: boolean;
};

export type FixPresentation = {
	actionLabel: string | null;
	stateLabel: string | null;
	reason: string | null;
	className: string;
};

const CLASSIFICATIONS: Record<FindingClassification, PresentationToken> = {
	confirmed: {
		label: "Confirmed",
		className: "vi-classification-confirmed",
	},
	candidate: {
		label: "Needs review",
		className: "vi-classification-candidate",
	},
	unverified: {
		label: "Could not verify",
		className: "vi-classification-unverified",
	},
};

export function presentClassification(
	classification: FindingClassification,
): PresentationToken {
	return CLASSIFICATIONS[classification];
}

export function presentLifecycle(
	status: CurrentFindingStatus,
): LifecyclePresentation {
	return status === "new"
		? { label: "New", className: "vi-status-new", showOnCard: true }
		: {
				label: "Previously found",
				className: "vi-status-persisting",
				showOnCard: false,
			};
}

export function presentFix(issue: Issue): FixPresentation | null {
	if (!issue.fixAction) return null;
	const eligibility = resolveEligibility(issue);
	const explanation = describeEligibility(issue);
	if (eligibility === "eligible") {
		return {
			actionLabel: "Fix this issue",
			stateLabel: null,
			reason: null,
			className: "vi-fix-ready",
		};
	}
	if (eligibility === "review-required") {
		return {
			actionLabel: "Review fix",
			stateLabel: explanation.status,
			reason: explanation.reason,
			className: "vi-fix-review",
		};
	}
	return {
		actionLabel: null,
		stateLabel: explanation.status,
		reason: explanation.reason,
		className: "vi-fix-unavailable",
	};
}
```

- [ ] **Step 5: Run focused and existing eligibility tests**

Run:

```bash
npm test -- src/tests/fix-eligibility.test.ts src/tests/report-presentation.test.ts src/tests/confirm-modal.test.ts src/tests/render-issue-actions.test.ts
```

Expected: all selected test files PASS; domain enums and action-policy tests remain unchanged.

- [ ] **Step 6: Commit the vocabulary boundary**

```bash
git add src/fix/fix-eligibility.ts src/fix/confirm-modal.ts src/report/presentation.ts src/report/render-issues.ts src/tests/fix-eligibility.test.ts src/tests/report-presentation.test.ts src/tests/confirm-modal.test.ts
git commit -m "refactor: isolate report presentation vocabulary"
```

---

### Task 2: Put filters and batch selection behind one progressive disclosure

**Files:**
- Create: `src/report/render-controls.ts`
- Create: `src/tests/render-controls.test.ts`
- Modify: `src/report/InspectorView.ts`
- Modify: `src/report/report-model.ts`
- Modify: `src/tests/inspector-view-filters.test.ts`
- Modify: `styles.css`
- Modify: `src/tests/styles.test.ts`

- [ ] **Step 1: Write failing control-panel tests**

Create `src/tests/render-controls.test.ts` using the existing Obsidian DOM mock helpers. Cover these observable requirements:

```ts
it("collapses optional controls when no filter is active", () => {
	const details = renderControls({
		filters: emptyFilters,
		expanded: false,
		selectionMode: false,
	});
	expect(details.open).toBe(false);
	expect(details.textContent).toContain("Filter and select");
	expect(details.textContent).not.toContain("active");
});

it("opens controls and reports the number of active filters", () => {
	const details = renderControls({
		filters: { ...emptyFilters, severity: "error", status: "new" },
		expanded: false,
		selectionMode: false,
	});
	expect(details.open).toBe(true);
	expect(details.textContent).toContain("2 active");
});

it("preserves scanner, severity, lifecycle, classification, and selection callbacks", () => {
	const onFiltersChange = vi.fn();
	const onSelectionModeChange = vi.fn();
	const details = renderControls({ onFiltersChange, onSelectionModeChange });
	findButton(details, "Broken Links (1)").click();
	findButton(details, "Errors (1)").click();
	findButton(details, "New (1)").click();
	findButton(details, "Needs review (1)").click();
	findButton(details, "Select findings").click();
	expect(onFiltersChange).toHaveBeenCalledTimes(4);
	expect(onSelectionModeChange).toHaveBeenCalledWith(true);
});
```

Use concrete fixtures matching `IssueFilterView`, `SCANNER_LABELS`, and the current DOM test utilities; do not snapshot the full DOM.

- [ ] **Step 2: Run the new test and verify the renderer is missing**

Run:

```bash
npm test -- src/tests/render-controls.test.ts
```

Expected: FAIL because `render-controls.ts` does not exist.

- [ ] **Step 3: Add disclosure state to the report model**

Add one UI-only field to `ReportModel`:

```ts
controlsExpanded: boolean;
```

Initialize it to `false` in `InspectorView`. Do not persist it to plugin data. Keep it `true` while filters are active or selection mode is active; reset it to `false` when a new scan result is accepted and no filter survives.

- [ ] **Step 4: Extract the controls into `render-controls.ts`**

Create a renderer with this public contract:

```ts
import type { ScanResult } from "../scanner/Issue";
import { SCANNER_LABELS } from "../scanner/Issue";
import type { IssueFilterView, IssueFilters } from "./report-model";
import { presentClassification, presentLifecycle } from "./presentation";

export type ReportControlsConfig = {
	result: ScanResult;
	filterView: IssueFilterView;
	filters: IssueFilters;
	comparisonAvailable: boolean;
	expanded: boolean;
	selectionMode: boolean;
	onExpandedChange: (expanded: boolean) => void;
	onFiltersChange: (filters: IssueFilters) => void;
	onSelectionModeChange: (selectionMode: boolean) => void;
};

export function activeFilterCount(filters: IssueFilters): number {
	return [
		filters.scanner,
		filters.severity,
		filters.status,
		filters.classification,
	].filter((value) => value !== null).length;
}

export function renderReportControls(
	container: HTMLElement,
	config: ReportControlsConfig,
): HTMLDetailsElement {
	const active = activeFilterCount(config.filters);
	const details = container.createEl("details", {
		cls: "vi-controls-disclosure",
	});
	details.open = config.expanded || active > 0 || config.selectionMode;
	details.addEventListener("toggle", () => {
		config.onExpandedChange(details.open);
	});
	const summary = details.createEl("summary", {
		text: active > 0
			? `Filter and select · ${active} active`
			: "Filter and select",
	});
	summary.setAttr("aria-label", active > 0
		? `Filter and select, ${active} active filters`
		: "Filter and select");

	const body = details.createDiv({ cls: "vi-controls-body" });
	const update = (patch: Partial<IssueFilters>) => {
		config.onFiltersChange({ ...config.filters, ...patch });
	};

	const scanners = body.createDiv({ cls: "vi-filter-group" });
	createFilterButton(scanners, "All scanners", config.filters.scanner === null, () => {
		update({ scanner: null });
	});
	for (const scannerId of config.result.scannersRun) {
		const count = config.filterView.scannerCounts.get(scannerId) ?? 0;
		createFilterButton(
			scanners,
			`${SCANNER_LABELS[scannerId]} (${count})`,
			config.filters.scanner === scannerId,
			() => update({
				scanner: config.filters.scanner === scannerId ? null : scannerId,
			}),
		);
	}

	const severities = body.createDiv({ cls: "vi-filter-group" });
	for (const { severity, count } of config.filterView.severityFacets) {
		const label = severity === "error"
			? "Errors"
			: severity === "warning" ? "Warnings" : "Info";
		createFilterButton(
			severities,
			`${label} (${count})`,
			config.filters.severity === severity,
			() => update({
				severity: config.filters.severity === severity ? null : severity,
			}),
		);
	}

	if (config.comparisonAvailable) {
		const lifecycle = body.createDiv({ cls: "vi-filter-group" });
		for (const { status, count } of config.filterView.statusFacets) {
			createFilterButton(
				lifecycle,
				`${presentLifecycle(status).label} (${count})`,
				config.filters.status === status,
				() => update({
					status: config.filters.status === status ? null : status,
				}),
			);
		}
	}

	const classifications = body.createDiv({ cls: "vi-filter-group" });
	for (const { classification, count } of config.filterView.classificationFacets) {
		createFilterButton(
			classifications,
			`${presentClassification(classification).label} (${count})`,
			config.filters.classification === classification,
			() => update({
				classification: config.filters.classification === classification
					? null
					: classification,
			}),
		);
	}

	const actions = body.createDiv({ cls: "vi-controls-actions" });
	const select = actions.createEl("button", {
		text: config.selectionMode ? "Done selecting" : "Select findings",
	});
	select.addEventListener("click", () => {
		config.onSelectionModeChange(!config.selectionMode);
	});
	if (active > 0) {
		const clear = actions.createEl("button", { text: "Clear filters" });
		clear.addEventListener("click", () => {
			config.onFiltersChange({
				scanner: null,
				severity: null,
				status: null,
				classification: null,
			});
		});
	}
	return details;
}

function createFilterButton(
	container: HTMLElement,
	text: string,
	active: boolean,
	onClick: () => void,
): void {
	const button = container.createEl("button", {
		cls: `vi-filter-btn${active ? " vi-active" : ""}`,
		text,
		attr: { type: "button", "aria-pressed": String(active) },
	});
	button.addEventListener("click", onClick);
}
```

- [ ] **Step 5: Replace `InspectorView`’s four filter renderers with the extracted control panel**

Construct one `IssueFilters` object from the existing model fields, pass it to `renderReportControls`, and copy changed values back in `onFiltersChange`. Delete `renderScannerFilter`, `renderSeverityFilter`, `renderLifecycleFilter`, and `renderClassificationFilter` only after their behaviors are covered through the new renderer.

The selection callback must preserve the existing invariant:

```ts
onSelectionModeChange: (selectionMode) => {
	this.model.selectionMode = selectionMode;
	this.model.controlsExpanded = selectionMode || this.model.controlsExpanded;
	if (!selectionMode) this.model.selectedFingerprints = new Set();
	this.render();
},
```

- [ ] **Step 6: Add disclosure styles and accessibility checks**

Add `.vi-controls-disclosure`, `.vi-controls-body`, and `.vi-controls-actions` using Obsidian CSS variables. Keep button wrapping through margins, not CSS `gap`, because `lint:obsidian-warnings` rejects unsupported gap usage. Add visible `:focus-visible` outlines and ensure the summary has at least a 32px click target.

Extend `styles.test.ts` to assert:

```ts
for (const className of [
	"vi-controls-disclosure",
	"vi-controls-body",
	"vi-controls-actions",
]) {
	expect(css).toContain(`.${className}`);
}
expect(css).toMatch(/\.vi-controls-disclosure\s*>\s*summary\s*\{[^}]*min-height:\s*32px;/);
expect(css).toMatch(/\.vi-controls-disclosure\s*>\s*summary:focus-visible\s*\{/);
```

- [ ] **Step 7: Run control and view wiring tests**

Run:

```bash
npm test -- src/tests/render-controls.test.ts src/tests/inspector-view-filters.test.ts src/tests/styles.test.ts
```

Expected: PASS, including the existing lifecycle/classification filtering and batch-selection tests.

- [ ] **Step 8: Commit progressive controls**

```bash
git add src/report/render-controls.ts src/report/InspectorView.ts src/report/report-model.ts src/tests/render-controls.test.ts src/tests/inspector-view-filters.test.ts src/tests/styles.test.ts styles.css
git commit -m "feat: collapse advanced report controls"
```

---

### Task 3: Make the report summary answer “what needs attention?” first

**Files:**
- Modify: `src/report/render-summary.ts`
- Modify: `src/report/InspectorView.ts`
- Modify: `src/tests/render-summary.test.ts`
- Modify: `src/tests/inspector-view-filters.test.ts`
- Modify: `styles.css`

- [ ] **Step 1: Replace dashboard-oriented expectations with changes-first expectations**

Add or update tests so the summary contract is explicit:

```ts
it("shows new and resolved findings as the primary compatible-scan result", () => {
	renderSummary(container, resultWithLifecycle, {
		comparison: compatibleComparison,
		onReviewNewFindings,
	});
	expect(container.textContent).toContain("2 new findings");
	expect(container.textContent).toContain("1 resolved");
	expect(container.textContent).toContain("Review new findings");
	expect(container.textContent).toContain("3 previously found");
	expect(container.textContent).not.toContain("PERSISTING");
});

it("uses a scan-complete result when there is no compatible baseline", () => {
	renderSummary(container, result, { comparison: firstScanComparison });
	expect(container.textContent).toContain("Scan complete");
	expect(container.textContent).toContain("5 active findings");
	expect(container.textContent).toContain("Future scans will highlight what changed");
});

it("explains a restarted comparison without presenting false lifecycle counts", () => {
	renderSummary(container, result, { comparison: settingsChangedComparison });
	expect(container.textContent).toContain("Comparison restarted");
	expect(container.textContent).toContain("Scan settings changed");
	expect(container.textContent).not.toContain("new findings");
});
```

- [ ] **Step 2: Run summary tests and verify the old four-stat layout fails**

Run:

```bash
npm test -- src/tests/render-summary.test.ts
```

Expected: FAIL on the new copy and hierarchy assertions.

- [ ] **Step 3: Replace the primary lifecycle dashboard with a compact change summary**

Keep `countNewConfirmedFindings` unchanged. Compute:

```ts
const newConfirmed = countNewConfirmedFindings(result.issues, comparison.statuses);
const newCount = newConfirmed.errors + newConfirmed.warnings;
const persistingCount = countStatus(result, comparison, "persisting");
const resolvedCount = comparison.resolvedIssues.filter((issue) => !issue.ignored).length;
```

Render the compatible case with one sentence-level result, one CTA, and secondary metadata:

```ts
const headline = changes.createDiv({ cls: "vi-changes-headline" });
headline.createSpan({
	cls: "vi-changes-primary",
	text: `${newCount} new ${newCount === 1 ? "finding" : "findings"}`,
});
headline.createSpan({
	cls: "vi-changes-resolved",
	text: `${resolvedCount} resolved`,
});

if (newCount > 0 && options.onReviewNewFindings) {
	const review = changes.createEl("button", {
		cls: "vi-review-new-btn mod-cta",
		text: "Review new findings",
		attr: { type: "button" },
	});
	review.addEventListener("click", options.onReviewNewFindings);
}

changes.createDiv({
	cls: "vi-changes-secondary",
	text: `${result.issues.length} active · ${persistingCount} previously found · compared with ${formatScanTime(comparison.previousScanAt!)}`,
});
```

When comparison is unavailable, render exactly one of these actions:

- first scan: `Scan complete` and `Future scans will highlight what changed.`;
- settings changed: `Comparison restarted` and `Scan settings changed; this scan is the new baseline.`;
- semantics changed: `Comparison restarted` and `Scanner behavior changed; this scan is the new baseline.`

Keep files scanned, duration, scanner count, and ignored count in the existing secondary `.vi-meta` row.

- [ ] **Step 4: Render the summary before optional controls**

In `InspectorView.render()`, use this order:

```ts
renderSummary(container, this.model.result, summaryOptions);
this.renderControls(container, filterView);
renderOperationOutcomes(container, this.model.operationOutcomes, clearOutcomes);
```

Add a wiring test that records calls and asserts `renderSummary` is invoked before `renderReportControls`. Do not infer order from CSS.

- [ ] **Step 5: Update styles for a single primary visual hierarchy**

Style `.vi-changes-primary` as the strongest text, `.vi-changes-resolved` with success color but no full-width green bar, and `.vi-changes-secondary` as muted metadata. Preserve theme compatibility by using only Obsidian variables.

- [ ] **Step 6: Run summary and integration tests**

Run:

```bash
npm test -- src/tests/render-summary.test.ts src/tests/inspector-view-filters.test.ts src/tests/styles.test.ts
```

Expected: PASS; “Review new findings” still applies `status = new`, `classification = confirmed`, and clears the severity filter.

- [ ] **Step 7: Commit the summary hierarchy**

```bash
git add src/report/render-summary.ts src/report/InspectorView.ts src/tests/render-summary.test.ts src/tests/inspector-view-filters.test.ts src/tests/styles.test.ts styles.css
git commit -m "feat: focus scan summaries on actionable changes"
```

---

### Task 4: Simplify finding cards while preserving every detail

**Files:**
- Modify: `src/report/render-issues.ts`
- Modify: `src/report/render-evidence.ts`
- Modify: `src/tests/render-issue-actions.test.ts`
- Modify: `src/tests/render-evidence.test.ts`
- Modify: `styles.css`
- Modify: `src/tests/styles.test.ts`

- [ ] **Step 1: Write failing tests for collapsed-card signal limits**

Add tests covering the exact default surface:

```ts
it("shows a New chip but hides the previously-found chip on collapsed cards", () => {
	const newlyRendered = renderIssues([issue], new Map([[issue.fingerprint, "new"]]));
	expect(newlyRendered.textContent).toContain("New");

	const persistingRendered = renderIssues(
		[issue],
		new Map([[issue.fingerprint, "persisting"]]),
	);
	expect(persistingRendered.textContent).not.toContain("Previously found");
});

it("does not duplicate a ready-to-fix status beside the Fix action", () => {
	const rendered = renderExpandedIssue(makeFixIssueWith("eligible"));
	expect(rendered.textContent).toContain("Fix this issue");
	expect(rendered.textContent).not.toContain("Ready to fix");
	expect(rendered.textContent).not.toContain("Eligible");
});

it("keeps review and blocked reasons visible when they affect the next action", () => {
	expect(renderExpandedIssue(makeFixIssueWith("review-required")).textContent)
		.toContain("Review before fixing");
	expect(renderExpandedIssue(makeFixIssueWith("blocked")).textContent)
		.toContain("Fix unavailable");
});
```

Update `render-evidence.test.ts` to expect `Needs review`, `Could not verify`, `Keep in mind`, `Recommended next step`, and `Technical evidence` instead of raw uppercase classifications and terse labels.

- [ ] **Step 2: Run the finding renderer tests and verify they fail on old copy**

Run:

```bash
npm test -- src/tests/render-issue-actions.test.ts src/tests/render-evidence.test.ts
```

Expected: FAIL on raw `PERSISTING`, `ELIGIBLE`, classification, and evidence-label expectations.

- [ ] **Step 3: Show lifecycle state on cards only when it changes the user’s priority**

Replace direct `status.toUpperCase()` rendering with:

```ts
const status = config.statuses?.get(issue.fingerprint);
if (status) {
	const presentation = presentLifecycle(status);
	if (presentation.showOnCard) {
		li.createSpan({
			cls: `vi-status-badge ${presentation.className}`,
			text: presentation.label,
		});
	}
}
```

Do not remove `persisting` from the model or filter facets.

- [ ] **Step 4: Render expanded interpretation in plain language**

Replace `renderFindingEvidence` with:

```ts
import type { Issue } from "../scanner/Issue";
import { presentClassification } from "./presentation";

export function renderFindingEvidence(container: HTMLElement, issue: Issue): void {
	const classification = presentClassification(issue.classification);
	container.createSpan({
		cls: `vi-classification-badge ${classification.className}`,
		text: classification.label,
	});

	const explanation = container.createDiv({ cls: "vi-explanation" });
	renderRow(explanation, "Why", issue.explanation.why);
	if (issue.explanation.caveat?.trim()) {
		renderRow(explanation, "Keep in mind", issue.explanation.caveat);
	}
	renderRow(explanation, "Recommended next step", issue.explanation.nextStep);

	const disclosure = container.createEl("details", {
		cls: "vi-evidence-disclosure",
	});
	disclosure.addEventListener("click", (event) => event.stopPropagation());
	disclosure.createEl("summary", { text: "Technical evidence" });
	for (const key of Object.keys(issue.evidence).sort()) {
		renderRow(disclosure, key, String(issue.evidence[key]));
	}
}

function renderRow(container: HTMLElement, label: string, value: string): void {
	const row = container.createDiv({ cls: "vi-explanation-row" });
	row.createSpan({ cls: "vi-explanation-label", text: label });
	row.createSpan({ cls: "vi-explanation-value", text: value });
}
```

- [ ] **Step 5: Remove duplicate fix-state presentation from issue details**

Call `presentFix(issue)` once. For eligible issues, render only the action button. For review-required or blocked issues, render one state line and one reason. Delete the separate `Fix` detail row and the unconditional `.vi-issue-fix-reason` block.

Use the same presentation object for action availability and copy:

```ts
const fix = presentFix(issue);
if (fix?.stateLabel) {
	const state = details.createDiv({ cls: `vi-fix-state ${fix.className}` });
	state.createSpan({ cls: "vi-fix-state-label", text: fix.stateLabel });
	if (fix.reason) {
		state.createSpan({ cls: "vi-fix-state-reason", text: fix.reason });
	}
}
```

Create the button only when `fix?.actionLabel` is non-null. Leave `selectBulkFixable` unchanged so bulk safety still derives from the domain enum rather than copy.

- [ ] **Step 6: Update styles and run focused tests**

Add styles for `.vi-fix-state`, `.vi-fix-state-label`, `.vi-fix-state-reason`, `.vi-fix-review`, and `.vi-fix-unavailable`. Remove unused eligible-badge styles only after `rg` proves no renderer emits those classes. Preserve `.vi-eligibility-*` styles if the confirmation modal still uses them at this stage.

Run:

```bash
npm test -- src/tests/render-issue-actions.test.ts src/tests/render-evidence.test.ts src/tests/styles.test.ts
```

Expected: PASS; selection, path navigation, ignore, exclude-folder, and settings actions remain covered.

- [ ] **Step 7: Commit the finding-card simplification**

```bash
git add src/report/render-issues.ts src/report/render-evidence.ts src/tests/render-issue-actions.test.ts src/tests/render-evidence.test.ts src/tests/styles.test.ts styles.css
git commit -m "feat: simplify finding decisions and details"
```

---

### Task 5: Keep confirmation safety visible and technical mechanics optional

**Files:**
- Modify: `src/fix/confirm-modal.ts`
- Modify: `src/tests/confirm-modal.test.ts`
- Modify: `styles.css`
- Modify: `src/tests/styles.test.ts`

- [ ] **Step 1: Write failing tests for decision-first confirmation content**

Extend `confirm-modal.test.ts` with these requirements:

```ts
it("shows the user decision before reference mechanics", () => {
	const modal = renderConfirmation([eligibleTrashIssue]);
	expect(modal.textContent).toContain("Move 1 file to trash");
	expect(modal.textContent).toContain("Reference details");
	expect(findDetails(modal, "Reference details").open).toBe(false);
});

it("keeps an unsafe reference condition visible without opening details", () => {
	const modal = renderConfirmation([incompleteCoverageIssue]);
	expect(modal.textContent).toContain("Fix unavailable");
	expect(modal.textContent).toContain("Some references could not be checked");
});

it("uses action-specific confirm labels", () => {
	expect(confirmButton(renderConfirmation([eligibleTrashIssue])).textContent)
		.toBe("Move to trash");
	expect(confirmButton(renderConfirmation([eligibleLinkIssue])).textContent)
		.toBe("Apply fix");
	expect(confirmButton(renderConfirmation([eligibleTrashIssue, eligibleLinkIssue])).textContent)
		.toBe("Apply selected fixes");
});
```

- [ ] **Step 2: Run modal tests and verify the old impact-card layout fails**

Run:

```bash
npm test -- src/tests/confirm-modal.test.ts
```

Expected: FAIL on disclosure state and confirm-button copy.

- [ ] **Step 3: Separate the decision from reference mechanics**

Keep these items visible on every actionable card:

- finding title;
- target path;
- file size and modification date;
- action consequence (`Modify note` or `Move file to trash`);
- explicit duplicate keep choice when required;
- review-required or blocked reason.

Move neutral mechanics into a closed disclosure:

```ts
const referenceDetails = card.createEl("details", {
	cls: "vi-impact-reference-details",
});
referenceDetails.createEl("summary", { text: "Reference details" });
referenceDetails.createDiv({
	text: `Inbound references: ${issue.impact.inboundReferences}`,
});
referenceDetails.createDiv({
	text: `Coverage: ${issue.impact.coverageComplete ? "Complete" : "Incomplete"}`,
});
```

Do not hide incomplete coverage, multiple referenced duplicate copies, unknown file stats, or any condition that blocks/changes the decision. Those conditions remain visible through `describeEligibility(issue).reason`.

- [ ] **Step 4: Make the confirm action describe the mutation**

Add this pure helper and cover it directly:

```ts
export function confirmButtonLabel(actions: FixAction[]): string {
	if (actions.length !== 1) return "Apply selected fixes";
	return actions[0].kind === "trash-file" ? "Move to trash" : "Apply fix";
}
```

Use the helper when creating the confirmation button. Keep the disabled state tied to `plan.complete`; do not enable blocked or unreviewed actions through presentation logic.

- [ ] **Step 5: Update responsive styles and verification**

Add `.vi-impact-reference-details` and ensure its content wraps at narrow widths. Run:

```bash
npm test -- src/tests/confirm-modal.test.ts src/tests/fix-decisions.test.ts src/tests/fix-runner.test.ts src/tests/styles.test.ts
```

Expected: PASS; all action-policy, decision, preflight, stale-decision, and final-verification behaviors remain intact.

- [ ] **Step 6: Commit the confirmation hierarchy**

```bash
git add src/fix/confirm-modal.ts src/tests/confirm-modal.test.ts src/tests/styles.test.ts styles.css
git commit -m "feat: make fix confirmations decision first"
```

---

### Task 6: Restore a plugin-first product story without weakening the CLI

**Files:**
- Create: `docs/cli.md`
- Create: `src/tests/documentation-boundary.test.ts`
- Modify: `README.md`
- Modify: `skills/vault-inspector/SKILL.md`

- [ ] **Step 1: Write a failing documentation-boundary test**

Create `src/tests/documentation-boundary.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("documentation product boundary", () => {
	it("keeps the Obsidian workflow before optional automation", async () => {
		const readme = await readFile("README.md", "utf8");
		expect(readme.indexOf("## Use in Obsidian"))
			.toBeLessThan(readme.indexOf("## Optional CLI automation"));
		expect(readme).toContain("[CLI reference](docs/cli.md)");
	});

	it("keeps automation contracts in the dedicated CLI reference", async () => {
		const cli = await readFile("docs/cli.md", "utf8");
		for (const required of [
			"## Installation",
			"## Configuration",
			"## JSON protocol",
			"## Baseline comparison",
			"## Exit codes",
			"comparison.fingerprints",
			"ignoredFoldersByScanner",
			"--fail-on",
		]) {
			expect(cli).toContain(required);
		}
	});

	it("states the mutation boundary in both plugin and CLI docs", async () => {
		const readme = await readFile("README.md", "utf8");
		const cli = await readFile("docs/cli.md", "utf8");
		expect(readme).toContain("Fixes run only after explicit confirmation");
		expect(cli).toContain("CLI scan mode is read-only");
	});
});
```

- [ ] **Step 2: Run the test and verify the new documentation structure is absent**

Run:

```bash
npm test -- src/tests/documentation-boundary.test.ts
```

Expected: FAIL because `docs/cli.md` and the new README headings do not exist.

- [ ] **Step 3: Rewrite the README around the community-plugin path**

Use this top-level order:

```markdown
# Vault Inspector

[one-paragraph Obsidian plugin value proposition]

## What it checks
## Install in Obsidian
## Use in Obsidian
## How safe fixes work
## Settings
## Optional CLI automation
## Privacy and network access
## Development
## License
```

Requirements for the rewrite:

- keep the eight scanner descriptions near the top;
- describe the primary workflow as Run scan → Review new findings → Fix or ignore;
- explain fix confirmation and verification without exposing enum names;
- state `Fixes run only after explicit confirmation`;
- limit “Optional CLI automation” to installation examples, the read-only boundary, and a link to `[CLI reference](docs/cli.md)`;
- retain Community Plugins and manual installation instructions;
- retain external-link privacy/network disclosure;
- remove detailed JSON protocol and baseline semantics from README only after moving them intact to `docs/cli.md`.

- [ ] **Step 4: Create the complete CLI reference**

Move and normalize the current CLI material into `docs/cli.md` under these exact headings:

```markdown
# Vault Inspector CLI

The CLI is an optional, read-only companion for local automation and CI.

## Installation
## Quick start
## Commands and flags
## Configuration
## Output formats
## JSON protocol
## Baseline comparison
## Exit codes
## Network access
## Package boundary
```

Preserve all currently documented flags, configuration keys, stable JSON fields, `comparison.fingerprints` completeness rules, profile/legacy/none modes, incompatibility reasons, exit-code precedence, release-asset distinction, and the reserved `--fix` statement. Do not simplify protocol text by removing edge cases.

- [ ] **Step 5: Point the bundled skill to the dedicated reference**

Add a short reference line to `skills/vault-inspector/SKILL.md` without duplicating the entire protocol:

```markdown
For the full flag, configuration, JSON protocol, baseline compatibility, and exit-code contract, read [`docs/cli.md`](../../docs/cli.md) from the repository checkout.
```

Keep the skill’s read-only rules and current command examples unchanged.

- [ ] **Step 6: Run documentation and package tests**

Run:

```bash
npm test -- src/tests/documentation-boundary.test.ts src/tests/cli.test.ts src/tests/cli-package.test.ts
npm pack --dry-run
```

Expected: all tests PASS; the package still contains `README.md`, `cli.js`, and the existing release assets. `docs/cli.md` does not need to enter the npm package unless a separate packaging decision explicitly adds it.

- [ ] **Step 7: Commit the product-positioning split**

```bash
git add README.md docs/cli.md skills/vault-inspector/SKILL.md src/tests/documentation-boundary.test.ts
git commit -m "docs: separate plugin and CLI product paths"
```

---

### Task 7: Verify that simplification did not remove capability

**Files:**
- Modify only if verification exposes a regression in files already touched by Tasks 1–6.

- [ ] **Step 1: Run focused domain-contract tests**

Run:

```bash
npm test -- src/tests/action-policy.test.ts src/tests/fix-decisions.test.ts src/tests/fix-runner.test.ts src/tests/result-diff.test.ts src/tests/scan-history.test.ts src/tests/scan-scheduler.test.ts src/tests/scan-session.test.ts src/tests/scan-profile.test.ts src/tests/cli.test.ts
```

Expected: PASS. Any failure means the presentation work crossed a prohibited domain boundary; fix the presentation integration rather than changing expected domain behavior.

- [ ] **Step 2: Run the complete repository gate**

Run:

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm pack --dry-run
```

Expected:

- every command exits `0`;
- no `obsidianmd/*` rule is disabled;
- coverage thresholds remain satisfied;
- package contents remain within the established plugin/npm boundaries.

- [ ] **Step 3: Inspect the built artifact for removed domain labels**

Raw enum strings may still exist internally or in CLI output. Verify only that the default rendered report copy no longer depends on them:

```bash
rg -n 'toUpperCase\(\)|text: status|text: classification|Eligible|Review required|Blocked' src/report src/fix
```

Expected: no direct raw-state rendering in `src/report/**`; safety-domain comparisons remain in policy and selection code.

- [ ] **Step 4: Perform a manual Obsidian smoke test in `/Users/Roger/my-vault`**

Use the development build and verify these flows:

1. First scan shows “Scan complete,” active count, and no lifecycle vocabulary.
2. A compatible repeat scan shows new/resolved change summary before controls.
3. “Review new findings” displays only new confirmed errors/warnings.
4. “Filter and select” starts collapsed, opens on demand, and preserves every existing facet.
5. A new finding shows a `New` chip; a persisting finding has no default chip but remains filterable as “Previously found.”
6. Expanded candidate and unverified findings show “Needs review” and “Could not verify.”
7. Eligible single-item fix shows “Fix this issue” without a redundant eligibility badge.
8. Review-required fix shows the reason before confirmation.
9. Blocked fix cannot be executed and clearly explains why.
10. Duplicate keep selection, batch exclusion, preflight rescan, and final verification still work.
11. Narrow sidebar and light/dark themes keep paths, buttons, and disclosures readable.
12. Automatic scanning remains disabled by default and external-link checks still require separate opt-in.

- [ ] **Step 5: Review the diff against the non-goals**

Run:

```bash
git diff 0.7.1...HEAD -- src/scanner src/snapshot cli src/settings/settings.ts package.json manifest.json versions.json
```

Expected: no scanner-semantic, snapshot-schema, CLI-protocol, setting-default, package, or version change. If the diff contains one, revert or split it into a separately approved project.

- [ ] **Step 6: Record final verification in the PR description, not a new product document**

Use this checklist:

```markdown
## Verification

- `npm run lint`
- `npm run lint:obsidian-warnings`
- `npm run build`
- `npm test`
- `npm pack --dry-run`
- Manual Obsidian smoke test in `/Users/Roger/my-vault`

## Preserved boundaries

- Eight scanners unchanged
- Scanner semantics and fingerprints unchanged
- Fix policy and verified execution unchanged
- Lifecycle/history/automatic scan unchanged
- CLI schema, flags, exit codes, and read-only mode unchanged
```

Do not add AI attribution, generated-by text, or co-author trailers.

---

## Completion criteria

The work is complete only when all of the following are true:

- a first-time user can complete the primary scan/review/fix path without interpreting raw lifecycle, classification, eligibility, profile, or coverage terminology;
- every current filter and advanced detail remains reachable within one disclosure from the report;
- safety-critical reasons remain visible at the moment they affect a fix decision;
- scanners, fingerprints, action policy, lifecycle comparison, history, scheduler, export, and CLI protocol show no behavioral diff;
- the README presents Vault Inspector first as an Obsidian community plugin;
- CLI users retain a complete, linked reference rather than shortened or deleted documentation;
- focused tests, full CI-equivalent checks, package inspection, and manual Obsidian verification all pass.
