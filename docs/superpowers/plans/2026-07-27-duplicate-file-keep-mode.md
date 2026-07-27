# Duplicate File Keep Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default duplicate cleanup to an explicit keep-file choice while retaining the current lexicographic automatic selection as an opt-in setting.

**Architecture:** Keep the scanner responsible for identifying hash-identical candidate groups and describing the automatic choice. Add a pure decision module that converts user choices into deletion actions and revalidates those choices against fresh scan results. The confirmation modal only collects choices and previews impact; `main.ts` remains responsible for rescanning and executing validated actions.

**Tech Stack:** TypeScript, Obsidian Plugin API, Vitest, ESLint, esbuild

**Design:** `docs/superpowers/specs/2026-07-27-issue-100-scanner-exclusions-duplicate-keep-design.md`

---

## Execution context

Create `feat/duplicate-keep-mode` from the latest `origin/main` in an isolated
worktree. Implement this plan before the scanner-specific exclusion plan because
it hardens a destructive action. Deliver it in its own pull request.

## File map

- Modify `src/settings/settings.ts`: define `DuplicateKeepMode` and default to `always-ask`.
- Modify `src/settings/settings-tab.ts`: add the keep-mode dropdown.
- Modify `src/tests/settings.test.ts`: verify default and legacy loading.
- Modify `src/tests/settings-tab.test.ts`: verify the searchable setting definition.
- Modify `src/scanner/Issue.ts`: add structured `keep-one` selection metadata.
- Modify `src/scanner/scanners/duplicate-files.ts`: attach sorted candidates and the automatic keep path.
- Modify `src/tests/duplicate-files.test.ts`: verify metadata and keep current non-fixable candidate behavior.
- Create `src/fix/fix-decisions.ts`: build decisions, resolve actions, and validate fresh scan state.
- Create `src/tests/fix-decisions.test.ts`: exhaustively test pure decision and freshness behavior.
- Modify `src/fix/confirm-modal.ts`: render duplicate groups and return decisions.
- Modify `src/tests/confirm-modal.test.ts`: test summaries built from resolved actions.
- Modify `src/main.ts`: pass mode to the modal, rescan, validate, execute, and report skips.
- Modify `src/tests/main.test.ts`: cover execution and skip notices.
- Modify `styles.css`: style keep-choice groups without unsupported CSS.
- Modify `README.md`: document the default, automatic rule, and safety behavior.

### Task 1: Add the keep-mode setting

**Files:**
- Modify: `src/settings/settings.ts`
- Modify: `src/settings/settings-tab.ts`
- Test: `src/tests/settings.test.ts`
- Test: `src/tests/settings-tab.test.ts`

- [ ] **Step 1: Write failing settings tests**

Add these cases to `src/tests/settings.test.ts`:

```ts
it("defaults duplicate cleanup to always ask", () => {
	expect(DEFAULT_SETTINGS.duplicateKeepMode).toBe("always-ask");
});

it("loads old settings with the safe duplicate keep default", async () => {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	plugin.loadData = vi.fn(async () => ({
		duplicateHashMaxBytes: 2 * 1024 * 1024,
	}));

	await plugin.loadSettings();

	expect(plugin.settings.duplicateKeepMode).toBe("always-ask");
});

it("preserves an explicit automatic duplicate keep mode", async () => {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	plugin.loadData = vi.fn(async () => ({
		duplicateKeepMode: "automatic",
	}));

	await plugin.loadSettings();

	expect(plugin.settings.duplicateKeepMode).toBe("automatic");
});
```

In `src/tests/settings-tab.test.ts`, add `"Duplicate file keep mode"` immediately after `"Enable fix actions"` in the expected setting names.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm test -- src/tests/settings.test.ts src/tests/settings-tab.test.ts
```

Expected: FAIL because `duplicateKeepMode` and its setting control do not exist.

- [ ] **Step 3: Add the type and default**

Update `src/settings/settings.ts`:

```ts
export type DuplicateKeepMode = "always-ask" | "automatic";

export type InspectorSettings = {
	enabledScanners: Record<ScannerId, boolean>;
	enableFixActions: boolean;
	duplicateKeepMode: DuplicateKeepMode;
	largeMarkdownBytes: number;
	largeAttachmentBytes: number;
	ignoredLargeMarkdownFrontmatterKeys: string[];
	ignoredLargeMarkdownPathPatterns: string[];
	duplicateHashMaxBytes: number;
	lowUsageTagThreshold: number;
	emptyNoteWordThreshold: number;
	watchedTags: string[];
	ignoredIssueFingerprints: string[];
	ignoredFolders: string[];
	ignoredProperties: string[];
	reportFolderPath: string;
};
```

Add this default immediately after `enableFixActions`:

```ts
duplicateKeepMode: "always-ask",
```

The existing top-level settings spread in `loadSettings()` supplies this default when persisted data omits it; no migration write is required.

- [ ] **Step 4: Add the dropdown to Fix actions**

Add this item after `Enable fix actions` in `src/settings/settings-tab.ts`:

```ts
{
	name: "Duplicate file keep mode",
	desc: "Always ask which hash-identical file to keep, or automatically keep the first vault-relative path in alphabetical order.",
	render: (setting) => {
		setting.addDropdown((dropdown) =>
			dropdown
				.addOption("always-ask", "Always ask")
				.addOption("automatic", "Automatically choose")
				.setValue(this.plugin.settings.duplicateKeepMode)
				.onChange(async (value) => {
					this.plugin.settings.duplicateKeepMode =
						value === "automatic" ? "automatic" : "always-ask";
					await this.plugin.saveSettings();
				}),
		);
	},
},
```

- [ ] **Step 5: Run focused settings tests**

Run:

```bash
npm test -- src/tests/settings.test.ts src/tests/settings-tab.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the setting**

```bash
git add src/settings/settings.ts src/settings/settings-tab.ts src/tests/settings.test.ts src/tests/settings-tab.test.ts
git commit -m "feat: add duplicate file keep mode"
```

### Task 2: Describe keep choices in duplicate fix actions

**Files:**
- Modify: `src/scanner/Issue.ts`
- Modify: `src/scanner/scanners/duplicate-files.ts`
- Test: `src/tests/duplicate-files.test.ts`

- [ ] **Step 1: Write failing duplicate metadata tests**

Extend the hash-identical test in `src/tests/duplicate-files.test.ts`:

```ts
expect(hashIssues[0].fixAction).toEqual({
	kind: "trash-file",
	label: "Delete duplicates",
	description: 'Keep "notes/a.md" and move 1 duplicate(s) to trash',
	targetPaths: ["notes/b.md"],
	selection: {
		kind: "keep-one",
		candidatePaths: ["notes/a.md", "notes/b.md"],
		automaticKeepPath: "notes/a.md",
	},
});
```

Add:

```ts
it("sorts complete paths before choosing the automatic keep file", async () => {
	const sharedContent = new Uint8Array([1, 2, 3]);
	const ctx = makeCtx({
		allFiles: [
			makeFile("z-last/copy.md", 3),
			makeFile("a-first/copy.md", 3),
			makeFile("m-middle/copy.md", 3),
		],
		vault: {
			readBinary: async () => sharedContent.buffer,
		} as any,
	});

	const [issue] = await duplicateFilesScanner.scan(ctx);

	expect(issue.fixAction?.selection).toEqual({
		kind: "keep-one",
		candidatePaths: [
			"a-first/copy.md",
			"m-middle/copy.md",
			"z-last/copy.md",
		],
		automaticKeepPath: "a-first/copy.md",
	});
	expect(issue.fixAction?.targetPaths).toEqual([
		"m-middle/copy.md",
		"z-last/copy.md",
	]);
});
```

Extend the same-name and same-size candidate tests with:

```ts
expect(nameIssues[0].fixAction).toBeUndefined();
```

and:

```ts
expect(sizeIssues[0].fixAction).toBeUndefined();
```

- [ ] **Step 2: Run the duplicate scanner tests and verify they fail**

Run:

```bash
npm test -- src/tests/duplicate-files.test.ts
```

Expected: FAIL because `FixAction.selection` does not exist.

- [ ] **Step 3: Add structured selection metadata**

Update `src/scanner/Issue.ts`:

```ts
export type KeepOneSelection = {
	kind: "keep-one";
	candidatePaths: string[];
	automaticKeepPath: string;
};

export type FixAction = {
	kind: FixActionKind;
	label: string;
	description: string;
	targetPaths: string[];
	linkText?: string;
	selection?: KeepOneSelection;
};
```

- [ ] **Step 4: Attach sorted candidates to hash-identical actions**

Update the hash-identical issue in `src/scanner/scanners/duplicate-files.ts`:

```ts
const sorted = paths.slice().sort();
const kept = sorted[0];
const duplicates = sorted.slice(1);
issues.push({
	scannerId: "duplicate-files",
	severity: "warning",
	title: "Duplicate files (hash-identical)",
	message: `${sorted.length} files have identical content`,
	relatedPaths: sorted,
	evidence: {
		count: sorted.length,
		paths: sorted.join(", "),
	},
	fingerprint: generateFingerprint("duplicate-files", undefined, {
		paths: sorted.join(","),
	}),
	fixAction: {
		kind: "trash-file",
		label: "Delete duplicates",
		description:
			`Keep "${kept}" and move ${duplicates.length} duplicate(s) to trash`,
		targetPaths: duplicates,
		selection: {
			kind: "keep-one",
			candidatePaths: sorted,
			automaticKeepPath: kept,
		},
	},
});
```

- [ ] **Step 5: Run the duplicate scanner tests**

Run:

```bash
npm test -- src/tests/duplicate-files.test.ts src/tests/markdown-export.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit selection metadata**

```bash
git add src/scanner/Issue.ts src/scanner/scanners/duplicate-files.ts src/tests/duplicate-files.test.ts
git commit -m "feat: describe duplicate keep choices"
```

### Task 3: Build a pure decision and freshness layer

**Files:**
- Create: `src/fix/fix-decisions.ts`
- Create: `src/tests/fix-decisions.test.ts`

- [ ] **Step 1: Write failing decision tests**

Create `src/tests/fix-decisions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	buildFixDecisionState,
	getFreshFixAction,
	resolveDecisionAction,
} from "../fix/fix-decisions";
import type { FixAction, Issue } from "../scanner/Issue";

function makeDuplicateIssue(
	fingerprint = "duplicates",
	paths = ["a.md", "b.md", "c.md"],
): Issue {
	const sorted = paths.slice().sort();
	const automaticKeepPath = sorted[0];
	const action: FixAction = {
		kind: "trash-file",
		label: "Delete duplicates",
		description:
			`Keep "${automaticKeepPath}" and move ${sorted.length - 1} duplicate(s) to trash`,
		targetPaths: sorted.slice(1),
		selection: {
			kind: "keep-one",
			candidatePaths: sorted,
			automaticKeepPath,
		},
	};
	return {
		scannerId: "duplicate-files",
		severity: "warning",
		title: "Duplicate files (hash-identical)",
		message: `${sorted.length} files have identical content`,
		relatedPaths: sorted,
		evidence: { count: sorted.length, paths: sorted.join(", ") },
		fingerprint,
		fixAction: action,
	};
}

function makePlainIssue(): Issue {
	return {
		scannerId: "empty-notes",
		severity: "warning",
		title: "Empty note",
		message: "Empty note",
		primaryPath: "empty.md",
		relatedPaths: [],
		evidence: {},
		fingerprint: "empty",
		fixAction: {
			kind: "trash-file",
			label: "Delete empty note",
			description: "Move empty.md to trash",
			targetPaths: ["empty.md"],
		},
	};
}

describe("fix decisions", () => {
	it("requires an explicit keep path in always-ask mode", () => {
		const state = buildFixDecisionState(
			[makeDuplicateIssue()],
			"always-ask",
			new Map(),
		);

		expect(state.complete).toBe(false);
		expect(state.decisions).toEqual([]);
	});

	it("builds automatic and mixed decisions", () => {
		const state = buildFixDecisionState(
			[makeDuplicateIssue(), makePlainIssue()],
			"automatic",
			new Map(),
		);

		expect(state).toEqual({
			complete: true,
			decisions: [
				{ fingerprint: "duplicates", keepPath: "a.md" },
				{ fingerprint: "empty" },
			],
		});
	});

	it.each(["a.md", "b.md", "c.md"])(
		"removes every duplicate except selected keep path %s",
		(keepPath) => {
			const issue = makeDuplicateIssue();
			const action = resolveDecisionAction(issue, {
				fingerprint: issue.fingerprint,
				keepPath,
			});

			expect(action?.targetPaths).toEqual(
				["a.md", "b.md", "c.md"].filter((path) => path !== keepPath),
			);
			expect(action?.targetPaths).not.toContain(keepPath);
		},
	);

	it("rebuilds a duplicate action from an unchanged fresh candidate set", () => {
		const requested = makeDuplicateIssue();
		const fresh = makeDuplicateIssue();

		const action = getFreshFixAction(requested, fresh, {
			fingerprint: requested.fingerprint,
			keepPath: "c.md",
		});

		expect(action?.targetPaths).toEqual(["a.md", "b.md"]);
	});

	it("rejects changed candidate sets and missing keep paths", () => {
		const requested = makeDuplicateIssue();

		expect(getFreshFixAction(
			requested,
			makeDuplicateIssue("duplicates", ["a.md", "b.md"]),
			{ fingerprint: "duplicates", keepPath: "b.md" },
		)).toBeNull();
		expect(getFreshFixAction(
			requested,
			makeDuplicateIssue(),
			{ fingerprint: "duplicates", keepPath: "missing.md" },
		)).toBeNull();
	});

	it("keeps exact matching behavior for non-duplicate actions", () => {
		const requested = makePlainIssue();
		const fresh = makePlainIssue();

		expect(getFreshFixAction(
			requested,
			fresh,
			{ fingerprint: "empty" },
		)).toEqual(fresh.fixAction);

		fresh.fixAction = {
			...fresh.fixAction!,
			targetPaths: ["changed.md"],
		};
		expect(getFreshFixAction(
			requested,
			fresh,
			{ fingerprint: "empty" },
		)).toBeNull();
	});
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm test -- src/tests/fix-decisions.test.ts
```

Expected: FAIL because `fix-decisions.ts` does not exist.

- [ ] **Step 3: Implement the pure decision state**

Create `src/fix/fix-decisions.ts` with these exported types and functions:

```ts
import type { FixAction, Issue } from "../scanner/Issue";
import type { DuplicateKeepMode } from "../settings/settings";

export type FixDecision = {
	fingerprint: string;
	keepPath?: string;
};

export type FixDecisionState = {
	complete: boolean;
	decisions: FixDecision[];
};

export function buildFixDecisionState(
	issues: Issue[],
	mode: DuplicateKeepMode,
	selectedKeeps: ReadonlyMap<string, string>,
): FixDecisionState {
	const decisions: FixDecision[] = [];
	let complete = true;

	for (const issue of issues) {
		const action = issue.fixAction;
		if (!action) continue;
		const selection = action.selection;
		if (!selection) {
			decisions.push({ fingerprint: issue.fingerprint });
			continue;
		}
		const keepPath = mode === "automatic"
			? selection.automaticKeepPath
			: selectedKeeps.get(issue.fingerprint);
		if (!keepPath || !selection.candidatePaths.includes(keepPath)) {
			complete = false;
			continue;
		}
		decisions.push({ fingerprint: issue.fingerprint, keepPath });
	}

	return { complete, decisions };
}

export function resolveDecisionAction(
	issue: Issue,
	decision: FixDecision,
): FixAction | null {
	const action = issue.fixAction;
	if (!action || decision.fingerprint !== issue.fingerprint) return null;
	const selection = action.selection;
	if (!selection) return decision.keepPath === undefined ? action : null;
	if (
		!decision.keepPath
		|| !selection.candidatePaths.includes(decision.keepPath)
	) {
		return null;
	}
	const targetPaths = selection.candidatePaths.filter(
		(path) => path !== decision.keepPath,
	);
	return {
		...action,
		description:
			`Keep "${decision.keepPath}" and move ${targetPaths.length} duplicate(s) to trash`,
		targetPaths,
	};
}

export function getFreshFixAction(
	requestedIssue: Issue,
	freshIssue: Issue | undefined,
	decision: FixDecision,
): FixAction | null {
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

	if (requested.selection || fresh.selection) {
		if (
			!requested.selection
			|| !fresh.selection
			|| requested.kind !== fresh.kind
			|| requested.label !== fresh.label
			|| !samePaths(
				requested.selection.candidatePaths,
				fresh.selection.candidatePaths,
			)
		) {
			return null;
		}
		return resolveDecisionAction(freshIssue, decision);
	}

	return fixActionsMatch(requested, fresh) ? fresh : null;
}

function samePaths(left: string[], right: string[]): boolean {
	const sortedLeft = left.slice().sort();
	const sortedRight = right.slice().sort();
	return sortedLeft.length === sortedRight.length
		&& sortedLeft.every((path, index) => path === sortedRight[index]);
}

function fixActionsMatch(left: FixAction, right: FixAction): boolean {
	return left.kind === right.kind
		&& left.label === right.label
		&& left.description === right.description
		&& left.linkText === right.linkText
		&& left.targetPaths.length === right.targetPaths.length
		&& left.targetPaths.every(
			(path, index) => path === right.targetPaths[index],
		);
}
```

- [ ] **Step 4: Run the decision tests**

Run:

```bash
npm test -- src/tests/fix-decisions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the decision layer**

```bash
git add src/fix/fix-decisions.ts src/tests/fix-decisions.test.ts
git commit -m "feat: resolve duplicate keep decisions safely"
```

### Task 4: Collect keep decisions in the confirmation modal

**Files:**
- Modify: `src/fix/confirm-modal.ts`
- Modify: `src/tests/confirm-modal.test.ts`
- Modify: `styles.css`

- [ ] **Step 1: Update summary tests to use resolved actions**

Replace the namespace import with named imports, keep the existing
`summarizeFixActions` test, and add:

```ts
import type { FixAction, Issue } from "../scanner/Issue";
import {
	createSingleUseResolver,
	summarizeFixActions,
} from "../fix/confirm-modal";
import {
	buildFixDecisionState,
	resolveDecisionAction,
} from "../fix/fix-decisions";
```

Replace the optional namespace lookup in the existing test with:

```ts
const summary = summarizeFixActions(actions);
```

Then add:

```ts
it("previews a user-selected duplicate keep path", () => {
	const issue: Issue = {
		scannerId: "duplicate-files",
		severity: "warning",
		title: "Duplicate files (hash-identical)",
		message: "3 files have identical content",
		relatedPaths: ["a.md", "b.md", "c.md"],
		evidence: { count: 3, paths: "a.md, b.md, c.md" },
		fingerprint: "duplicates",
		fixAction: {
			kind: "trash-file",
			label: "Delete duplicates",
			description: 'Keep "a.md" and move 2 duplicate(s) to trash',
			targetPaths: ["b.md", "c.md"],
			selection: {
				kind: "keep-one",
				candidatePaths: ["a.md", "b.md", "c.md"],
				automaticKeepPath: "a.md",
			},
		},
	};
	const state = buildFixDecisionState(
		[issue],
		"always-ask",
		new Map([["duplicates", "c.md"]]),
	);
	const actions = state.decisions
		.map((decision) => resolveDecisionAction(issue, decision))
		.filter((action): action is FixAction => action !== null);

	expect(state.complete).toBe(true);
	expect(summarizeFixActions(actions)).toEqual({
		title: "Confirm fix",
		description: 'Keep "c.md" and move 2 duplicate(s) to trash',
		paths: ["a.md", "b.md"],
	});
});

it("settles a modal result only once", () => {
	const values: Array<string | null> = [];
	const settle = createSingleUseResolver<string | null>(
		(value) => values.push(value),
	);

	expect(settle("confirmed")).toBe(true);
	expect(settle(null)).toBe(false);
	expect(values).toEqual(["confirmed"]);
});
```

- [ ] **Step 2: Run the focused modal tests**

Run:

```bash
npm test -- src/tests/confirm-modal.test.ts
```

Expected: FAIL because `createSingleUseResolver` does not exist.

- [ ] **Step 3: Change the modal contract**

Change the exported function signature:

```ts
export function showConfirmModal(
	app: App,
	issues: Issue[],
	mode: DuplicateKeepMode,
): Promise<FixDecision[] | null> {
	return new Promise((resolve) => {
		new ConfirmFixModal(app, issues, mode, resolve).open();
	});
}
```

Import:

```ts
import type { FixAction, Issue } from "../scanner/Issue";
import type { DuplicateKeepMode } from "../settings/settings";
import {
	buildFixDecisionState,
	type FixDecision,
	resolveDecisionAction,
} from "./fix-decisions";
```

- [ ] **Step 4: Replace boolean modal state with decision state**

Export this small settlement helper from `src/fix/confirm-modal.ts`:

```ts
export function createSingleUseResolver<T>(
	resolve: (value: T) => void,
): (value: T) => boolean {
	let settled = false;
	return (value) => {
		if (settled) return false;
		settled = true;
		resolve(value);
		return true;
	};
}
```

`ConfirmFixModal` must own:

```ts
private selectedKeeps = new Map<string, string>();
private settle: (result: FixDecision[] | null) => boolean;
```

Its constructor stores `issues` and `mode`, then initializes:

```ts
constructor(
	app: App,
	private issues: Issue[],
	private mode: DuplicateKeepMode,
	resolve: (result: FixDecision[] | null) => void,
) {
	super(app);
	this.settle = createSingleUseResolver(resolve);
}
```

Add:

```ts
private finish(result: FixDecision[] | null): void {
	if (this.settle(result)) this.close();
}
```

Open by rendering the current state:

```ts
onOpen() {
	this.contentEl.addClass("vi-confirm-modal");
	this.renderContent();
}
```

`onClose()` attempts cancellation through the same single-use resolver:

```ts
onClose() {
	this.contentEl.empty();
	this.settle(null);
}
```

- [ ] **Step 5: Render keep-one groups and gate confirmation**

In a `renderContent()` method:

1. Clear and re-add `vi-confirm-modal`.
2. Compute:

```ts
const state = buildFixDecisionState(
	this.issues,
	this.mode,
	this.selectedKeeps,
);
const decisionsByFingerprint = new Map(
	state.decisions.map((decision) => [decision.fingerprint, decision]),
);
const actions = this.issues.flatMap((issue) => {
	const decision = decisionsByFingerprint.get(issue.fingerprint);
	if (!decision) return [];
	const action = resolveDecisionAction(issue, decision);
	return action ? [action] : [];
});
const summary = summarizeFixActions(actions);
```

3. In `always-ask` mode, render one `.vi-keep-group` per action with `selection.kind === "keep-one"`.
4. Render a radio input for every `candidatePaths` entry. Give all radios in a group the same `name`.
5. On change, update `selectedKeeps` and call `renderContent()` again.
6. Render resolved action paths below the controls.
7. Set:

```ts
confirmBtn.disabled = !state.complete;
```

8. Confirm with:

```ts
confirmBtn.addEventListener("click", () => {
	if (state.complete) this.finish(state.decisions);
});
```

9. Cancel with:

```ts
cancelBtn.addEventListener("click", () => this.finish(null));
```

Automatic mode must not render `.vi-keep-group`; its decision state is complete immediately.

Use this loop for the keep controls:

```ts
if (this.mode === "always-ask") {
	for (const issue of this.issues) {
		const selection = issue.fixAction?.selection;
		if (!selection) continue;
		const group = contentEl.createDiv({ cls: "vi-keep-group" });
		group.createDiv({
			cls: "vi-keep-group-title",
			text: "Choose one file to keep",
		});
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
}
```

Use the issue count for the heading even while some duplicate groups are
unresolved:

```ts
contentEl.createEl("h3", {
	text: this.issues.length > 1
		? `Confirm batch fix (${this.issues.length} actions)`
		: "Confirm fix",
});
contentEl.createEl("p", {
	text: state.complete
		? summarizeFixActions(actions).description
		: "Choose one file to keep in every duplicate group.",
});
```

- [ ] **Step 6: Add compatible modal styles**

Add to `styles.css` without using `gap`:

```css
.vi-keep-group { margin: 0 0 16px; padding: 12px; border: 1px solid var(--background-modifier-border); border-radius: 4px; }
.vi-keep-group-title { margin: 0 0 8px; font-weight: 600; }
.vi-keep-option { display: flex; align-items: flex-start; margin: 6px 0 0; }
.vi-keep-option input { margin: 2px 8px 0 0; }
.vi-keep-option-path { overflow-wrap: anywhere; font-family: var(--font-monospace); font-size: 12px; }
.vi-confirm-destructive:disabled { cursor: not-allowed; opacity: 0.5; }
```

- [ ] **Step 7: Run modal, style, and build checks**

Run:

```bash
npm test -- src/tests/confirm-modal.test.ts src/tests/fix-decisions.test.ts src/tests/styles.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit the selection dialog**

```bash
git add src/fix/confirm-modal.ts src/tests/confirm-modal.test.ts styles.css
git commit -m "feat: ask which duplicate file to keep"
```

### Task 5: Revalidate and execute decisions

**Files:**
- Modify: `src/main.ts`
- Modify: `src/tests/main.test.ts`

- [ ] **Step 1: Rewrite confirmation mocks to return decisions**

Change existing successful modal mocks from:

```ts
showConfirmModalMock.mockResolvedValue(true);
```

to fingerprint-specific results. In the first freshness test use:

```ts
showConfirmModalMock.mockResolvedValue(
	staleIssues.map((issue) => ({ fingerprint: issue.fingerprint })),
);
```

In the sequential revalidation test use:

```ts
showConfirmModalMock.mockResolvedValue([
	{ fingerprint: firstIssue.fingerprint },
	{ fingerprint: secondIssue.fingerprint },
]);
```

In the result-counting test use:

```ts
showConfirmModalMock.mockResolvedValue(
	issues.map((issue) => ({ fingerprint: issue.fingerprint })),
);
```

For new duplicate tests, include the chosen path:

```ts
showConfirmModalMock.mockResolvedValue([
	{ fingerprint: "duplicates", keepPath: "c.md" },
]);
```

Use `null` for cancellation tests.

- [ ] **Step 2: Add failing fresh-duplicate execution tests**

Add to `src/tests/main.test.ts`:

```ts
it("executes a fresh duplicate action using the selected keep path", async () => {
	const duplicate = makeDuplicateIssue(
		"duplicates",
		["a.md", "b.md", "c.md"],
	);
	const run = vi.fn().mockResolvedValue(makeScanResult([duplicate]));
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	(plugin as any).app = {};
	(plugin as any).scanRunner = { run };
	plugin.settings = {
		...structuredClone(DEFAULT_SETTINGS),
		duplicateKeepMode: "always-ask",
	};
	showConfirmModalMock.mockResolvedValue([
		{ fingerprint: "duplicates", keepPath: "c.md" },
	]);
	executeFixActionMock.mockResolvedValue(2);

	const callbacks = configureCallbacks(plugin);
	await callbacks.onFixAllIssues([duplicate]);

	expect(showConfirmModalMock).toHaveBeenCalledWith(
		(plugin as any).app,
		[duplicate],
		"always-ask",
	);
	expect(executeFixActionMock).toHaveBeenCalledWith(
		(plugin as any).app,
		expect.objectContaining({
			targetPaths: ["a.md", "b.md"],
		}),
	);
	expect(noticeMessages).toContain("Fixed 2 items");
});

it("skips a duplicate group whose candidates changed after confirmation", async () => {
	const stale = makeDuplicateIssue(
		"duplicates",
		["a.md", "b.md", "c.md"],
	);
	const changed = makeDuplicateIssue(
		"duplicates",
		["a.md", "b.md"],
	);
	const run = vi.fn().mockResolvedValue(makeScanResult([changed]));
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	(plugin as any).app = {};
	(plugin as any).scanRunner = { run };
	showConfirmModalMock.mockResolvedValue([
		{ fingerprint: "duplicates", keepPath: "b.md" },
	]);

	const callbacks = configureCallbacks(plugin);
	await callbacks.onFixAllIssues([stale]);

	expect(executeFixActionMock).not.toHaveBeenCalled();
	expect(noticeMessages).toContain(
		"No items were fixed; skipped 1 changed issue",
	);
});
```

Add focused test helpers at file scope:

```ts
function makeDuplicateIssue(fingerprint: string, paths: string[]): Issue {
	const sorted = paths.slice().sort();
	const keepPath = sorted[0];
	return {
		scannerId: "duplicate-files",
		severity: "warning",
		title: "Duplicate files (hash-identical)",
		message: `${sorted.length} files have identical content`,
		relatedPaths: sorted,
		evidence: { count: sorted.length, paths: sorted.join(", ") },
		fingerprint,
		fixAction: {
			kind: "trash-file",
			label: "Delete duplicates",
			description:
				`Keep "${keepPath}" and move ${sorted.length - 1} duplicate(s) to trash`,
			targetPaths: sorted.slice(1),
			selection: {
				kind: "keep-one",
				candidatePaths: sorted,
				automaticKeepPath: keepPath,
			},
		},
	};
}

function configureCallbacks(plugin: VaultInspectorPlugin) {
	let callbacks: any;
	const view = {
		setCallbacks: vi.fn((value) => { callbacks = value; }),
		setEnableFixActions: vi.fn(),
		setScanning: vi.fn(),
		setScanProgress: vi.fn(),
		setResult: vi.fn(),
	};
	(plugin as any).configureView(view);
	return callbacks;
}
```

- [ ] **Step 3: Run main tests and verify the new cases fail**

Run:

```bash
npm test -- src/tests/main.test.ts
```

Expected: FAIL because `main.ts` still expects a boolean and executes the old target list.

- [ ] **Step 4: Execute fingerprint-matched decisions**

Import:

```ts
import { getFreshFixAction } from "./fix/fix-decisions";
```

Replace the confirmation and execution body in `onFixAllIssues`:

```ts
if (!issues.some((issue) => issue.fixAction)) return;
const decisions = await showConfirmModal(
	this.app,
	issues,
	this.settings.duplicateKeepMode,
);
if (!decisions) return;
const decisionsByFingerprint = new Map(
	decisions.map((decision) => [decision.fingerprint, decision]),
);

let fixed = 0;
let skipped = 0;
for (const issue of issues) {
	const decision = decisionsByFingerprint.get(issue.fingerprint);
	if (!decision) {
		skipped++;
		continue;
	}
	const freshResult = await this.scan(view);
	if (!freshResult) return;
	const freshIssue = freshResult.issues.find(
		(candidate) => candidate.fingerprint === issue.fingerprint,
	);
	const freshAction = getFreshFixAction(issue, freshIssue, decision);
	if (!freshAction) {
		skipped++;
		continue;
	}
	try {
		fixed += await executeFixAction(this.app, freshAction);
	} catch {
		// Continue on individual failures.
	}
}
new Notice(formatFixResultNotice(fixed, skipped));
await this.scanAndRender(view);
```

Remove `getMatchingFreshFixActions()` and `fixActionsMatch()` from `src/main.ts`; their logic now lives in `fix-decisions.ts`.
Also remove the now-unused `FixAction` and `Issue` type import from `src/main.ts`.

- [ ] **Step 5: Add deterministic result messaging**

Export from `src/main.ts`:

```ts
export function formatFixResultNotice(fixed: number, skipped: number): string {
	const fixedText = fixed > 0
		? `Fixed ${fixed} item${fixed === 1 ? "" : "s"}`
		: "No items were fixed";
	if (skipped === 0) return fixedText;
	return `${fixedText}; skipped ${skipped} changed ${skipped === 1 ? "issue" : "issues"}`;
}
```

Add unit assertions:

```ts
import VaultInspectorPlugin, {
	formatFixResultNotice,
	migrateExcalidrawFrontmatterKey,
} from "../main";

expect(formatFixResultNotice(0, 0)).toBe("No items were fixed");
expect(formatFixResultNotice(2, 0)).toBe("Fixed 2 items");
expect(formatFixResultNotice(0, 1))
	.toBe("No items were fixed; skipped 1 changed issue");
expect(formatFixResultNotice(1, 2))
	.toBe("Fixed 1 item; skipped 2 changed issues");
```

- [ ] **Step 6: Run execution tests**

Run:

```bash
npm test -- src/tests/main.test.ts src/tests/fix-decisions.test.ts src/tests/fix-executor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit safe execution**

```bash
git add src/main.ts src/tests/main.test.ts
git commit -m "fix: revalidate duplicate keep decisions"
```

### Task 6: Document and verify the feature

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the setting to the README table**

Add:

```md
| Duplicate file keep mode | Always ask | Require a keep-file choice, or automatically keep the alphabetically first vault-relative path |
```

- [ ] **Step 2: Document duplicate cleanup behavior**

Add below the Duplicate Files scanner description:

```md
Deletion is offered only for files confirmed identical by content hash. By
default, Vault Inspector asks which file to keep. Automatic mode keeps the first
complete vault-relative path in alphabetical order. Modification time, access
time, and file size do not choose the keep file.
```

- [ ] **Step 3: Run all required verification**

Run:

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm pack --dry-run
```

Expected:

- both lint commands exit with zero warnings;
- TypeScript and the production bundle build successfully;
- all Vitest tests pass;
- the package includes `main.js`, `cli.js`, `manifest.json`, `styles.css`, `versions.json`, `README.md`, and `LICENSE`.

- [ ] **Step 4: Perform a manual Obsidian smoke test**

Create two hash-identical groups:

```text
group-one/a.md
group-one/b.md
group-one/c.md
group-two/first.png
group-two/second.png
```

Verify in `Always ask` mode:

- Confirm is disabled before selections are made;
- choosing `group-one/c.md` keeps that file and trashes only `a.md` and `b.md`;
- selecting two duplicate groups requires one choice per group;
- cancelling or closing the modal changes no files;
- mixing a duplicate issue with an empty-note deletion produces one batch confirmation.

Switch to `Automatically choose` and verify:

- no keep-choice radio groups appear;
- the confirmation identifies the alphabetically first full path as the keep file;
- confirmation is still required before trashing files.

During an open confirmation modal, remove or rename one candidate externally and verify the changed group is skipped with a notice.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain duplicate keep modes"
```

## Completion criteria

- `Always ask` is the default for fresh and upgraded installations.
- Automatic mode exactly preserves the current full-path lexicographic rule.
- Every always-ask duplicate group requires one explicit keep choice.
- Same-name and same-size unverified candidates remain non-fixable.
- Fresh candidate changes skip the whole group.
- The keep path is never included in the executed target list.
- Non-duplicate fix actions preserve existing freshness behavior.
- Automated and manual verification pass.
