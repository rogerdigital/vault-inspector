# Issue #100 Feature Design

## Summary

Issue #100 contains two independent feature requests:

1. Allow a folder to participate in some scanners while being excluded from others.
2. Allow users to choose which hash-identical duplicate file to keep, with a setting that can preserve automatic selection.

The features will be implemented and shipped independently. The first extends scan configuration without changing existing global exclusions. The second changes the default duplicate deletion experience to require an explicit keep choice while retaining the current automatic behavior as an opt-in setting.

## Goals

- Preserve the current global ignored-folder behavior.
- Add scanner-specific ignored folders as additional exclusions.
- Keep scanner filtering logic centralized and consistent.
- Make duplicate deletion safe when the desired keep file cannot be inferred.
- Preserve the existing automatic duplicate selection rule as an explicit mode.
- Revalidate files after confirmation and before deletion.
- Keep the CLI scan mode read-only and avoid expanding this work into duplicate merging.

## Non-goals

- Result filtering or searching by path.
- Glob patterns for scanner-specific ignored folders.
- Per-scanner inclusion-only rules.
- Duplicate content diffing or file merging.
- Automatic keep strategies based on size, modification time, creation time, or access time.
- Deleting same-name or same-size candidates whose content hash has not been confirmed identical.
- Changing Obsidian's trash behavior.

## Feature 1: Scanner-specific ignored folders

### Settings model

Add a complete scanner-keyed record to `InspectorSettings`:

```ts
type InspectorSettings = {
	ignoredFolders: string[];
	ignoredFoldersByScanner: Record<ScannerId, string[]>;
};
```

`ignoredFolders` remains the global list and applies to every scanner. Each entry in `ignoredFoldersByScanner` adds exclusions for one scanner only.

The default record is generated from `SCANNER_IDS`, with an empty array for every scanner. Settings loading deep-merges the persisted record over the default record so that:

- existing installations receive empty scanner-specific lists;
- newly added scanners receive an empty list automatically;
- persisted values for existing scanners remain unchanged.

Folder values are trimmed, empty values are removed, and duplicate values are removed before saving.

### Effective scan context

`ScanRunner` computes the effective ignored folders immediately before invoking each scanner:

```ts
const ignoredFolders = [
	...settings.ignoredFolders,
	...settings.ignoredFoldersByScanner[scanner.id],
];
```

The values are deduplicated, and a scanner-specific `ScanContext` is created by copying the base context and replacing `ignoredFolders`.

This keeps the existing scanner contract intact. All scanners continue to call `isIgnoredPath(path, ctx.ignoredFolders)` and do not need scanner-by-scanner filtering changes.

The scanner-specific context must not mutate the shared base context. A scanner's exclusions must therefore not leak into the next scanner.

### Settings interface

The current `Ignored folders` setting remains in the `Ignored items` section. Its description changes to state that the folders are excluded from every scanner.

A new `Scanner-specific ignored folders` section contains one comma-separated text field for every scanner in `SCANNER_IDS`. Labels use `SCANNER_LABELS`, and descriptions state that the folders are additional exclusions for that scanner.

Example:

```text
Ignored folders: archive
Broken Links: syncTrash, drafts
Empty Notes: templates, stubs
Duplicate Files:
```

With this configuration:

- `archive` is excluded from all scanners;
- `syncTrash` and `drafts` are additionally excluded from Broken Links;
- `templates` and `stubs` are additionally excluded from Empty Notes;
- Duplicate Files scans every folder except `archive`.

### Compatibility

No destructive migration is required. Missing `ignoredFoldersByScanner` data resolves to the default empty record. The existing `ignoredFolders` field and its semantics remain unchanged.

The CLI `--exclude` option and CLI configuration format remain unchanged. Scanner-specific plugin settings are not added to the CLI in this feature.

### Validation

Tests must prove:

- the default settings record includes every scanner;
- loading old settings fills the complete empty record;
- loading partial scanner-specific settings preserves values and fills missing scanners;
- global and scanner-specific exclusions are combined and deduplicated;
- a scanner-specific exclusion is visible only to its scanner;
- `syncTrash` can be included in Duplicate Files while excluded from Broken Links;
- the settings interface exposes one scanner-specific field per scanner;
- existing scanner ignored-folder tests continue to pass.

## Feature 2: Select the duplicate file to keep

### Settings model

Add a duplicate keep mode:

```ts
export type DuplicateKeepMode = "always-ask" | "automatic";

type InspectorSettings = {
	duplicateKeepMode: DuplicateKeepMode;
};
```

The default is `always-ask`. Existing installations that do not have the setting adopt the safer default after upgrading.

The settings interface uses a dropdown:

- `Always ask`
- `Automatically choose`

The automatic option description states that Vault Inspector sorts complete vault-relative paths and keeps the first path. It does not imply that size, modification time, or access time affects the choice.

### Eligible duplicate groups

The scanner continues to offer a deletion action only for files whose content hashes are identical. Same-name and same-size informational candidates remain non-fixable.

The duplicate scanner sorts the complete candidate path list once. The first path is the automatic keep path, and all remaining paths are the automatic target paths.

The fix action receives structured selection metadata:

```ts
type KeepOneSelection = {
	kind: "keep-one";
	candidatePaths: string[];
	automaticKeepPath: string;
};

type FixAction = {
	kind: FixActionKind;
	label: string;
	description: string;
	targetPaths: string[];
	linkText?: string;
	selection?: KeepOneSelection;
};
```

`candidatePaths` is sorted and contains every file in the hash-identical group. `automaticKeepPath` is the first candidate. `targetPaths` remains the automatic deletion list so existing report and CLI consumers retain a concrete default action.

Only duplicate hash actions use `selection`. Existing trash and broken-link actions remain unchanged.

### Confirmation result

The confirmation flow must retain the issue fingerprint so a decision can be matched to a fresh scan:

```ts
type FixDecision = {
	fingerprint: string;
	keepPath?: string;
};
```

The confirmation modal accepts the selected issues and duplicate keep mode. It returns `FixDecision[]` when confirmed and `null` when cancelled.

Non-duplicate actions return a decision without `keepPath`. Duplicate actions in automatic mode return their `automaticKeepPath`. Duplicate actions in always-ask mode return the user's selected path.

### Always-ask interface

For each duplicate group, the modal shows:

- the issue title;
- all candidate vault-relative paths;
- a radio button for each path;
- a clear `Keep` label;
- the number of files that will be moved to trash after a choice is made.

No radio option is preselected. Confirm remains disabled until every duplicate group has one selected keep path.

When multiple duplicate groups are selected, every group appears in the same modal and requires an independent keep choice.

When duplicate issues are selected together with other fixable issues, the duplicate groups show keep controls and the other actions remain in the normal impact summary. The user confirms the entire batch once.

The modal displays the final unique list of paths that will be modified or moved to trash. Changing a keep choice updates the displayed impact before confirmation.

### Automatic interface

Automatic mode does not show keep controls. The confirmation modal uses `automaticKeepPath` and the existing target paths. The normal confirmation step remains mandatory.

### Freshness and execution safety

The current implementation rescans before each fix. That behavior remains, but duplicate decisions are applied only after fresh validation:

1. Find the fresh issue by fingerprint.
2. Verify that the fresh issue still has a fix action and `keep-one` selection.
3. Verify that the original and fresh candidate sets are identical after sorting.
4. Verify that the selected keep path exists in the fresh candidate set.
5. Build a fresh action whose `targetPaths` are every current candidate except the selected keep path.
6. Execute the fresh action.

If the issue disappeared, the candidate set changed, or the keep file no longer exists, the whole duplicate group is skipped. The implementation must not execute a subset of the stale target paths.

Non-duplicate actions continue to use the existing full action equality check.

The completion notice reports:

- the number of successfully fixed items;
- the number of groups skipped because their state changed.

Individual execution failures continue to leave the remaining selected fixes eligible for processing.

### Cancellation and closure

Cancelling the modal returns `null` and executes nothing. Closing the modal using Obsidian's close controls also resolves once with `null`. Confirmation resolves once with decisions and then closes without a second cancellation result.

### Validation

Tests must prove:

- the default keep mode is `always-ask`;
- old settings load with `always-ask`;
- automatic mode preserves the lexicographically first full path;
- only hash-identical groups receive keep selection metadata;
- same-name and same-size informational candidates remain non-fixable;
- always-ask mode starts without a selected keep path;
- Confirm stays disabled until every duplicate group has a selection;
- one group, multiple groups, and mixed action batches produce correct decisions;
- choosing the first, middle, or last candidate produces the correct target paths;
- cancellation and modal closure execute nothing and resolve once;
- unchanged fresh candidate sets execute the selected deletion plan;
- changed or missing candidate sets skip the whole group;
- automatic mode and always-ask mode never include the keep path in `targetPaths`;
- existing non-duplicate fix actions retain their current matching behavior.

## Documentation

README settings documentation will describe:

- global ignored folders;
- scanner-specific ignored folders as additional exclusions;
- the default `Always ask` duplicate behavior;
- how to switch to automatic mode;
- the exact automatic keep rule.

The issue response or release notes should describe only the shipped behavior. Diffing and merging remain future wishlist items.

## Delivery strategy

The two features are independent and should use separate implementation plans, branches, pull requests, and release notes:

1. Scanner-specific ignored folders.
2. Duplicate keep mode and selection flow.

Each feature must independently pass:

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm pack --dry-run
```

The duplicate keep feature should be implemented first because it changes a destructive action and has the higher safety impact. The scanner-specific exclusion feature can follow without depending on it.
