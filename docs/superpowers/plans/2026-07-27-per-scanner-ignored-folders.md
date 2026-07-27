# Per-scanner Ignored Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve global ignored folders while allowing every scanner to define additional ignored folders.

**Architecture:** Store scanner-specific exclusions in a complete `Record<ScannerId, string[]>`, deep-merge it during settings loading, and let `ScanRunner` create an isolated context for each scanner with global and scanner-specific exclusions combined. Existing scanners keep using `ctx.ignoredFolders`, so the filtering contract and scanner implementations do not change.

**Tech Stack:** TypeScript, Obsidian Plugin API, Vitest, ESLint, esbuild

**Design:** `docs/superpowers/specs/2026-07-27-issue-100-scanner-exclusions-duplicate-keep-design.md`

---

## Execution context

Create `feat/scanner-specific-ignored-folders` from the latest `origin/main` in
an isolated worktree. This feature has no code dependency on the duplicate keep
mode plan and must be delivered in its own pull request.

## File map

- Modify `src/settings/settings.ts`: define and initialize `ignoredFoldersByScanner`.
- Modify `src/main.ts`: deep-merge scanner-specific settings when loading persisted data.
- Create `src/tests/scan-runner.test.ts`: verify context isolation and effective exclusions.
- Modify `src/scanner/ScanRunner.ts`: build a scanner-specific context without mutating the base context.
- Modify `src/settings/settings-tab.ts`: normalize comma-separated folder values and render one field per scanner.
- Modify `src/tests/settings.test.ts`: cover defaults and old/partial settings loading.
- Modify `src/tests/settings-tab.test.ts`: cover setting definitions and input normalization.
- Modify `README.md`: document global and scanner-specific behavior.

### Task 1: Add the persisted settings model

**Files:**
- Modify: `src/settings/settings.ts`
- Modify: `src/main.ts`
- Test: `src/tests/settings.test.ts`

- [ ] **Step 1: Write failing default and loading tests**

Add these imports and cases to `src/tests/settings.test.ts`:

```ts
import { SCANNER_IDS } from "../scanner/Issue";

it("defines an empty ignored-folder list for every scanner", () => {
	expect(Object.keys(DEFAULT_SETTINGS.ignoredFoldersByScanner)).toEqual(SCANNER_IDS);
	for (const scannerId of SCANNER_IDS) {
		expect(DEFAULT_SETTINGS.ignoredFoldersByScanner[scannerId]).toEqual([]);
	}
});

it("fills scanner-specific ignored-folder defaults for old settings", async () => {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	plugin.loadData = vi.fn(async () => ({
		ignoredFolders: ["archive"],
	}));

	await plugin.loadSettings();

	expect(plugin.settings.ignoredFolders).toEqual(["archive"]);
	expect(Object.keys(plugin.settings.ignoredFoldersByScanner)).toEqual(SCANNER_IDS);
	for (const scannerId of SCANNER_IDS) {
		expect(plugin.settings.ignoredFoldersByScanner[scannerId]).toEqual([]);
	}
});

it("preserves partial scanner-specific ignored folders and fills missing scanners", async () => {
	const plugin = new VaultInspectorPlugin({} as any, {} as any);
	plugin.loadData = vi.fn(async () => ({
		ignoredFoldersByScanner: {
			"broken-links": ["syncTrash"],
		},
	}));

	await plugin.loadSettings();

	expect(plugin.settings.ignoredFoldersByScanner["broken-links"]).toEqual(["syncTrash"]);
	expect(plugin.settings.ignoredFoldersByScanner["duplicate-files"]).toEqual([]);
	expect(Object.keys(plugin.settings.ignoredFoldersByScanner)).toEqual(SCANNER_IDS);
});
```

- [ ] **Step 2: Run the settings tests and verify the new assertions fail**

Run:

```bash
npm test -- src/tests/settings.test.ts
```

Expected: FAIL because `ignoredFoldersByScanner` does not exist.

- [ ] **Step 3: Add the complete scanner-keyed default**

Update `src/settings/settings.ts`:

```ts
export type InspectorSettings = {
	enabledScanners: Record<ScannerId, boolean>;
	enableFixActions: boolean;
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
	ignoredFoldersByScanner: Record<ScannerId, string[]>;
	ignoredProperties: string[];
	reportFolderPath: string;
};

export function createEmptyIgnoredFoldersByScanner(): Record<ScannerId, string[]> {
	return Object.fromEntries(
		SCANNER_IDS.map((id) => [id, []]),
	) as Record<ScannerId, string[]>;
}
```

Add this property to `DEFAULT_SETTINGS` immediately after `ignoredFolders`:

```ts
ignoredFoldersByScanner: createEmptyIgnoredFoldersByScanner(),
```

- [ ] **Step 4: Deep-merge persisted scanner values**

Update the settings assignment in `VaultInspectorPlugin.loadSettings()`:

```ts
this.settings = {
	...DEFAULT_SETTINGS,
	...loaded,
	enabledScanners: {
		...DEFAULT_SETTINGS.enabledScanners,
		...loaded.enabledScanners,
	},
	ignoredFoldersByScanner: {
		...createEmptyIgnoredFoldersByScanner(),
		...loaded.ignoredFoldersByScanner,
	},
};
```

Import the helper in `src/main.ts`:

```ts
import {
	createEmptyIgnoredFoldersByScanner,
	DEFAULT_SETTINGS,
	type InspectorSettings,
} from "./settings/settings";
```

- [ ] **Step 5: Run the settings tests**

Run:

```bash
npm test -- src/tests/settings.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the settings model**

```bash
git add src/settings/settings.ts src/main.ts src/tests/settings.test.ts
git commit -m "feat: add scanner-specific ignored folder settings"
```

### Task 2: Isolate effective exclusions in ScanRunner

**Files:**
- Create: `src/tests/scan-runner.test.ts`
- Modify: `src/scanner/ScanRunner.ts`

- [ ] **Step 1: Write a failing scanner-context isolation test**

Create `src/tests/scan-runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ScanRunner } from "../scanner/ScanRunner";
import { DEFAULT_SETTINGS } from "../settings/settings";
import type { ScanContext } from "../scanner/ScanContext";

function makeApp() {
	return {
		metadataCache: {},
		vault: {
			getMarkdownFiles: vi.fn(() => []),
			getFiles: vi.fn(() => []),
		},
	} as any;
}

describe("ScanRunner scanner-specific ignored folders", () => {
	it("combines global and scanner-specific folders without leaking between scanners", async () => {
		const seen = new Map<string, string[]>();
		const runner = new ScanRunner();
		runner.register({
			id: "broken-links",
			scan: (ctx: ScanContext) => {
				seen.set("broken-links", ctx.ignoredFolders);
				return [];
			},
		});
		runner.register({
			id: "duplicate-files",
			scan: (ctx: ScanContext) => {
				seen.set("duplicate-files", ctx.ignoredFolders);
				return [];
			},
		});
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.enabledScanners = {
			...settings.enabledScanners,
			"broken-links": true,
			"duplicate-files": true,
		};
		settings.ignoredFolders = ["archive", "shared"];
		settings.ignoredFoldersByScanner["broken-links"] = [
			"syncTrash",
			"shared",
		];
		settings.ignoredFoldersByScanner["duplicate-files"] = [];

		await runner.run(makeApp(), settings);

		expect(seen.get("broken-links")).toEqual([
			"archive",
			"shared",
			"syncTrash",
		]);
		expect(seen.get("duplicate-files")).toEqual(["archive", "shared"]);
		expect(settings.ignoredFolders).toEqual(["archive", "shared"]);
	});
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- src/tests/scan-runner.test.ts
```

Expected: FAIL because both scanners receive only the global list.

- [ ] **Step 3: Add an effective-folder helper**

Add this pure helper near the top of `src/scanner/ScanRunner.ts`:

```ts
export function getEffectiveIgnoredFolders(
	globalFolders: string[],
	scannerFolders: string[],
): string[] {
	return [...new Set([...globalFolders, ...scannerFolders])];
}
```

- [ ] **Step 4: Pass an isolated context to each scanner**

Immediately before `scanner.scan(...)`, construct a scanner-specific context:

```ts
const scannerContext: ScanContext = {
	...ctx,
	ignoredFolders: getEffectiveIgnoredFolders(
		settings.ignoredFolders,
		settings.ignoredFoldersByScanner[scanner.id] ?? [],
	),
};
const result = await scanner.scan(scannerContext, (progress) => {
	options.onProgress?.({
		...progress,
		scannerId: scanner.id,
		scannerIndex,
		scannerTotal,
		elapsedMs: Date.now() - startedAt,
	});
});
```

Do not assign to `ctx.ignoredFolders` inside the loop.

- [ ] **Step 5: Run focused scanner tests**

Run:

```bash
npm test -- src/tests/scan-runner.test.ts src/tests/duplicate-files.test.ts src/tests/broken-links.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the runner behavior**

```bash
git add src/scanner/ScanRunner.ts src/tests/scan-runner.test.ts
git commit -m "feat: apply ignored folders per scanner"
```

### Task 3: Add scanner-specific settings controls

**Files:**
- Modify: `src/settings/settings-tab.ts`
- Modify: `src/tests/settings-tab.test.ts`

- [ ] **Step 1: Write failing definition and normalization tests**

Update `src/tests/settings-tab.test.ts` to import `parseFolderList`:

```ts
import {
	InspectorSettingTab,
	parseFolderList,
} from "../settings/settings-tab";
```

Update the expected group headings:

```ts
expect(groups.map((group) => group.heading)).toEqual([
	"Enabled scanners",
	"Fix actions",
	"Thresholds",
	"Tags",
	"Ignored items",
	"Scanner-specific ignored folders",
	"Export",
]);
```

Replace the flat exact-name assertion with focused group assertions so this
feature does not couple the test to unrelated settings added by other work:

```ts
const namesByHeading = new Map(
	groups.map((group) => [
		group.heading,
		(group.items ?? []).map((item) => item.name),
	]),
);
expect(namesByHeading.get("Enabled scanners")).toEqual(
	SCANNER_IDS.map((id) => SCANNER_LABELS[id]),
);
expect(namesByHeading.get("Ignored items")).toEqual([
	"Ignored folders (comma-separated)",
	"Ignored frontmatter properties (comma-separated)",
]);
expect(namesByHeading.get("Scanner-specific ignored folders")).toEqual(
	SCANNER_IDS.map((id) => SCANNER_LABELS[id]),
);
expect(names).toEqual(expect.arrayContaining([
	"Enable fix actions",
	"Large Markdown threshold (kb)",
	"Duplicate hash cap (mb)",
	"Report folder",
]));
```

Add:

```ts
it("normalizes comma-separated folder lists", () => {
	expect(parseFolderList(" syncTrash, drafts, syncTrash, ,templates "))
		.toEqual(["syncTrash", "drafts", "templates"]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm test -- src/tests/settings-tab.test.ts
```

Expected: FAIL because the new group and helper do not exist.

- [ ] **Step 3: Add one normalization function**

Add to `src/settings/settings-tab.ts` before the class:

```ts
export function parseFolderList(value: string): string[] {
	return [...new Set(
		value
			.split(",")
			.map((folder) => folder.trim())
			.filter(Boolean),
	)];
}
```

Use it for both the existing global ignored-folder input and all new per-scanner inputs.

- [ ] **Step 4: Clarify the global setting**

Change the global description to:

```ts
desc: "Files in these folders are excluded from every scanner.",
```

Change its `onChange` assignment to:

```ts
this.plugin.settings.ignoredFolders = parseFolderList(value);
```

- [ ] **Step 5: Render scanner-specific fields**

Add this section immediately after `Ignored items`:

```ts
{
	heading: "Scanner-specific ignored folders",
	items: SCANNER_IDS.map((id) => ({
		name: SCANNER_LABELS[id],
		desc: `Additional folders excluded only from ${SCANNER_LABELS[id]}.`,
		render: (setting) => {
			setting.addText((text) =>
				text
					.setValue(
						this.plugin.settings.ignoredFoldersByScanner[id].join(", "),
					)
					.setPlaceholder("E.g. syncTrash, drafts")
					.onChange(async (value) => {
						this.plugin.settings.ignoredFoldersByScanner[id] =
							parseFolderList(value);
						await this.plugin.saveSettings();
					}),
			);
		},
	})),
},
```

- [ ] **Step 6: Run settings UI tests**

Run:

```bash
npm test -- src/tests/settings-tab.test.ts src/tests/settings.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the settings UI**

```bash
git add src/settings/settings-tab.ts src/tests/settings-tab.test.ts
git commit -m "feat: configure ignored folders by scanner"
```

### Task 4: Document and verify the feature

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the setting to the README table**

Replace the current ignored-folder row and add the scanner-specific row:

```md
| Ignored folders | (none) | Folders excluded from every scanner |
| Scanner-specific ignored folders | (none) | Additional folders excluded only from the selected scanner |
```

- [ ] **Step 2: Add a concrete example below the table**

```md
Global ignored folders apply to every scanner. Scanner-specific ignored folders
are additional exclusions. For example, add `syncTrash` only to Broken Links if
you want Duplicate Files to inspect that folder while broken-link checks skip it.
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
- the package contains the expected published assets and no source-only files.

- [ ] **Step 4: Perform a manual Obsidian smoke test**

Use a test vault containing:

```text
archive/broken.md
syncTrash/broken.md
syncTrash/copy-a.png
notes/copy-b.png
```

Configure:

```text
Global ignored folders: archive
Broken Links ignored folders: syncTrash
Duplicate Files ignored folders:
```

Run a scan and verify:

- neither scanner reports files in `archive`;
- Broken Links does not report `syncTrash/broken.md`;
- Duplicate Files still considers both copy files in `syncTrash` and `notes`;
- reopening settings preserves all values.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain scanner-specific ignored folders"
```

## Completion criteria

- Existing global exclusions behave exactly as before.
- Per-scanner exclusions are additional, not replacements.
- Scanner contexts cannot leak exclusions between runs.
- Old and partial settings load safely.
- CLI behavior is unchanged.
- Automated and manual verification pass.
