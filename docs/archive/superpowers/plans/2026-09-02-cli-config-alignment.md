# CLI Config Alignment Implementation Plan (Milestone 4, Task 4.3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the CLI config express per-scanner ignored folders and make the documentation tell the whole lifecycle story. `cli/cli.ts` accepts a new JSON config key `ignoredFoldersByScanner` (a `Partial<Record<ScannerId, string[]>>` matching the plugin setting's name and shape): `validateConfig` rejects unknown scanner keys (`Unknown scanner in ignoredFoldersByScanner: <key>`) and non-string-array entries (`ignoredFoldersByScanner.<id> must be an array of folder paths`) on the existing exit-2 config-error path; `loadConfig` spreads the config map over `createEmptyIgnoredFoldersByScanner()` so omitted scanner keys stay `[]`; `makeSettings` passes the resolved `Record<ScannerId, string[]>` into `InspectorSettings`. From there the existing machinery is untouched: `createScanProfile` hashes the per-scanner folders (so two runs with different per-scanner exclusions get different `comparison.scanProfile`, and a baseline recorded without them compared against a run with them is an exit-`2` `settings-changed` mismatch), and `ScanRunner.getEffectiveIgnoredFolders` unions them with global `ignoredFolders` per scanner. Documentation follows: README's config example gains the key, its baseline section is rewritten for profile-aware baselines (the `comparison` object, `available` gating, `profile`/`legacy`/`none` modes, `settings-changed`/`semantics-changed` reasons with exit `2` overriding `--fail-on` including `none`, legacy fingerprint-only mode with its stderr warning, `isNew` retention/omission, new/persisting/resolved counts), and `skills/vault-inspector/SKILL.md` teaches agents to interpret unavailable / legacy / new / persisting / resolved states read-only. `--fix` keeps exiting `2`. Two commits: code, then docs.

**Architecture:** All behavior changes live in `cli/cli.ts` — config type, validation, option defaulting, and `makeSettings`. `src/settings/settings.ts` and `src/scanner/scan-profile.ts` need NO changes: the `ignoredFoldersByScanner` shape, `createEmptyIgnoredFoldersByScanner`, the `ScanRunner` propagation, and the profile hash already exist from the issue-100 scanner-exclusions work (pinned by `src/tests/scan-profile.test.ts`). README and the Agent Skill are pure documentation edits with no code coupling beyond quoting real field names.

**Tech Stack:** TypeScript, Node (fs/promises), Vitest, Markdown

Design doc: `docs/superpowers/specs/2026-09-02-cli-config-alignment-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 4, Task 4.3 — final roadmap task)

---

## Ground rules

- Branch: `feat/cli-config-alignment`, cut from latest `main`.
- Two commits, in order: `feat: align CLI scanner exclusion profiles` (code: `cli/cli.ts` + `src/tests/cli.test.ts`), then `docs: explain CLI lifecycle comparison` (`README.md` + `skills/vault-inspector/SKILL.md` + this plan/spec pair).
- Config key name is `ignoredFoldersByScanner` — exactly the plugin setting's name. Value is a partial map: omitted scanner keys mean "no per-scanner exclusions for that scanner" (`[]`), never "inherit the plugin".
- Unknown scanner keys and non-string-array entries reject the whole config on the existing `loadConfig` error path (exit `2`, empty stdout, message on stderr). Never ignore a typo'd key silently.
- No new CLI flags; `--help`/usage text unchanged; no per-scanner flag is added.
- Deviation from the roadmap file list: `src/settings/settings.ts` and `src/scanner/scan-profile.ts` need NO changes — the shape (`ignoredFoldersByScanner: Record<ScannerId, string[]>`, `createEmptyIgnoredFoldersByScanner` at lines 20/30–35/54), the `ScanRunner` union (`getEffectiveIgnoredFolders`, `src/scanner/ScanRunner.ts` lines 110–116), and the profile hash (`src/scanner/scan-profile.ts` lines 20–25) already exist.
- Runs without a config (or without `ignoredFoldersByScanner` in it) must stay bit-identical: the option defaults to the empty map, which hashes to the same `comparison.scanProfile` the CLI emits today. Every pre-existing test in `src/tests/cli.test.ts` passes unedited.
- Documentation must not present `--fix` as available or add any write capability to the skill; the CLI stays read-only.
- Do not modify `src/scanner/scanners/*`, `src/scanner/ScanRunner.ts`, `src/scanner/scan-profile.ts`, `src/scanner/ScanContext.ts`, `src/scanner/result-diff.ts`, `src/snapshot/*`, `src/report/*`, `src/fix/*`, `src/settings/*`, `src/main.ts`, `styles.css`, `cli/local-vault.ts`, `cli/bin.ts`, or `package.json`.
- Full gates before each commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.
- Never `eslint-disable` any `obsidianmd/*` rule.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b feat/cli-config-alignment
```

---

### Task 2: Write the failing CLI tests first (TDD)

**Files:**
- Modify: `src/tests/cli.test.ts`

- [ ] **Step 1: Add the four new tests**

In `src/tests/cli.test.ts`, insert immediately after the closing `});` of the test `"rejects a non-boolean unresolved note config value"` (line 358) and before the config-`describe` block's closing `});` (line 359):

```typescript
	it("loads per-scanner ignored folders from config", async () => {
		await withVault(
			{
				"drafts/empty.md": "",
				"drafts/large.md": "x".repeat(30),
				"active/empty.md": "",
			},
			async (vaultPath) => {
				const configPath = join(vaultPath, "vault-inspector.config.json");
				await writeFile(
					configPath,
					JSON.stringify({
						scanners: ["empty-notes", "large-files"],
						largeMarkdownBytes: 10,
						ignoredFoldersByScanner: { "empty-notes": ["drafts"] },
					}),
					"utf8",
				);

				const result = await runCli(["scan", vaultPath, "--config", configPath]);

				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(2);
				expect(payload.issues).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							scannerId: "empty-notes",
							primaryPath: "active/empty.md",
						}),
						expect.objectContaining({
							scannerId: "large-files",
							primaryPath: "drafts/large.md",
						}),
					]),
				);
				expect(payload.issues).not.toContainEqual(
					expect.objectContaining({ primaryPath: "drafts/empty.md" }),
				);
			},
		);
	});

	it("changes the scan profile when per-scanner folders change", async () => {
		await withVault({ "drafts/empty.md": "", "active/empty.md": "" }, async (vaultPath) => {
			const first = await runCli([
				"scan",
				vaultPath,
				"--scanner",
				"empty-notes",
				"--fail-on",
				"none",
			]);
			const baselinePath = join(vaultPath, "baseline.json");
			await writeFile(baselinePath, first.stdout, "utf8");

			const configPath = join(vaultPath, "vault-inspector.config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					scanners: ["empty-notes"],
					ignoredFoldersByScanner: { "empty-notes": ["drafts"] },
				}),
				"utf8",
			);

			const second = await runCli([
				"scan",
				vaultPath,
				"--config",
				configPath,
				"--baseline",
				baselinePath,
				"--fail-on",
				"none",
			]);

			const payload = JSON.parse(second.stdout);
			expect(second.exitCode).toBe(2);
			expect(second.stderr).toContain("settings-changed");
			expect(payload.comparison).toEqual({
				available: false,
				mode: "profile",
				reason: "settings-changed",
				newIssues: 0,
				persistingIssues: 0,
				resolvedIssues: 0,
				scanProfile: expect.any(String),
				comparisonVersion: 2,
			});
		});
	});

	it("rejects an unknown scanner in ignoredFoldersByScanner", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const configPath = join(vaultPath, "vault-inspector.config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					ignoredFoldersByScanner: { "empty-note": ["drafts"] },
				}),
				"utf8",
			);

			const result = await runCli([vaultPath, "--config", configPath]);

			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(
				"Unknown scanner in ignoredFoldersByScanner: empty-note",
			);
		});
	});

	it("rejects a non-array ignoredFoldersByScanner entry", async () => {
		await withVault({ "empty.md": "" }, async (vaultPath) => {
			const configPath = join(vaultPath, "vault-inspector.config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					ignoredFoldersByScanner: { "empty-notes": "drafts" },
				}),
				"utf8",
			);

			const result = await runCli([vaultPath, "--config", configPath]);

			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(
				"ignoredFoldersByScanner.empty-notes must be an array of folder paths",
			);
		});
	});
```

Fixture arithmetic: the first test proves scoping — `drafts/` is excluded for
`empty-notes` only, so `drafts/empty.md` disappears while `drafts/large.md`
(large-files, same folder) and `active/empty.md` (empty-notes, different
folder) survive: exactly 2 issues. The second test pins the profile
contract: run 1 has no per-scanner folders, run 2 adds
`{ "empty-notes": ["drafts"] }` via config — identical vault, different
detection inputs, so `createScanProfile` differs, `resolveBaselineCompatibility`
returns `"settings-changed"`, exit is forced to `2` even under
`--fail-on none`, and all counts are zero (Task 4.2 semantics exercised by a
real config-driven detection change).

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/cli.test.ts
```

Expected: FAIL — the per-scanner test sees 3 issues (`drafts/empty.md` is
still reported), the profile test sees exit `0` with
`available: true`-style comparison counts (the config key is ignored, so the
profile is unchanged), and the two validation tests see exit `0` or `1`
(the unknown key / wrong-typed value is silently ignored today).

---

### Task 3: Implement per-scanner config support in `cli/cli.ts`

**Files:**
- Modify: `cli/cli.ts`

- [ ] **Step 1: Extend the settings import**

In `cli/cli.ts`, replace (line 7):

```typescript
import { DEFAULT_SETTINGS, type InspectorSettings } from "../src/settings/settings";
```

with:

```typescript
import {
	createEmptyIgnoredFoldersByScanner,
	DEFAULT_SETTINGS,
	type InspectorSettings,
} from "../src/settings/settings";
```

(`SCANNER_IDS` and `type ScannerId` are already imported on lines 4–5.)

- [ ] **Step 2: Add the option to `CliOptions`**

In `cli/cli.ts`, inside `type CliOptions` (lines 69–93), replace (line 78):

```typescript
	ignoredFolders: string[];
```

with:

```typescript
	ignoredFolders: string[];
	ignoredFoldersByScanner: Record<ScannerId, string[]>;
```

- [ ] **Step 3: Default the option in `parseArgs`**

In `cli/cli.ts`, inside the `options` initializer in `parseArgs` (lines 221–232), replace (lines 227–228):

```typescript
		ignoredFolders: [],
		ignoreUnresolvedNoteLinks: false,
```

with:

```typescript
		ignoredFolders: [],
		ignoredFoldersByScanner: createEmptyIgnoredFoldersByScanner(),
		ignoreUnresolvedNoteLinks: false,
```

- [ ] **Step 4: Add the key to `CliConfig`**

In `cli/cli.ts`, `type CliConfig` (lines 298–319) is `Partial<Pick<CliOptions, …>>`. `Pick` would force the full `Record<ScannerId, string[]>`, but config files must allow partial maps, so append an intersection after the closing `>` of the `Partial<Pick<…>>` expression:

```typescript
type CliConfig = Partial<
	Pick<
		CliOptions,
		| "scanners"
		| "severity"
		| "include"
		| "exclude"
		| "ignoredFolders"
		| "ignoreUnresolvedNoteLinks"
		| "baselinePath"
		| "failOn"
		| "largeMarkdownBytes"
		| "largeAttachmentBytes"
		| "ignoredLargeMarkdownFrontmatterKeys"
		| "ignoredLargeMarkdownPathPatterns"
		| "duplicateHashMaxBytes"
		| "lowUsageTagThreshold"
		| "emptyNoteWordThreshold"
		| "watchedTags"
		| "ignoredProperties"
	>
> & {
	ignoredFoldersByScanner?: Partial<Record<ScannerId, string[]>>;
};
```

(Do NOT add `ignoredFoldersByScanner` to the `Pick` list — the intersection
member alone defines the config shape.)

- [ ] **Step 5: Merge the config map in `loadConfig`**

In `cli/cli.ts`, inside `loadConfig`'s return object (lines 329–358), replace (lines 335–341):

```typescript
			ignoredFolders:
				args.ignoredFolders.length > 0
					? args.ignoredFolders
					: config.ignoredFolders ?? [],
			ignoreUnresolvedNoteLinks:
				args.ignoreUnresolvedNoteLinks ||
				(config.ignoreUnresolvedNoteLinks ?? false),
```

with:

```typescript
			ignoredFolders:
				args.ignoredFolders.length > 0
					? args.ignoredFolders
					: config.ignoredFolders ?? [],
			ignoredFoldersByScanner: config.ignoredFoldersByScanner
				? { ...args.ignoredFoldersByScanner, ...config.ignoredFoldersByScanner }
				: args.ignoredFoldersByScanner,
			ignoreUnresolvedNoteLinks:
				args.ignoreUnresolvedNoteLinks ||
				(config.ignoreUnresolvedNoteLinks ?? false),
```

(`args.ignoredFoldersByScanner` is always the full empty map from
`parseArgs`; the spread fills only the keys the config provides, so omitted
scanner keys stay `[]`.)

- [ ] **Step 6: Validate the config value**

In `cli/cli.ts`, inside `validateConfig` (lines 645–664), replace (lines 657–663):

```typescript
	if (
		config.ignoreUnresolvedNoteLinks !== undefined &&
		typeof config.ignoreUnresolvedNoteLinks !== "boolean"
	) {
		return "ignoreUnresolvedNoteLinks must be a boolean";
	}
	return null;
```

with:

```typescript
	if (
		config.ignoreUnresolvedNoteLinks !== undefined &&
		typeof config.ignoreUnresolvedNoteLinks !== "boolean"
	) {
		return "ignoreUnresolvedNoteLinks must be a boolean";
	}
	if (config.ignoredFoldersByScanner !== undefined) {
		if (
			typeof config.ignoredFoldersByScanner !== "object" ||
			config.ignoredFoldersByScanner === null ||
			Array.isArray(config.ignoredFoldersByScanner)
		) {
			return "ignoredFoldersByScanner must be an object of scanner IDs to folder arrays";
		}
		for (const [scannerId, folders] of Object.entries(config.ignoredFoldersByScanner)) {
			if (!SCANNER_IDS.includes(scannerId as ScannerId)) {
				return `Unknown scanner in ignoredFoldersByScanner: ${scannerId}`;
			}
			if (
				!Array.isArray(folders) ||
				folders.some((folder) => typeof folder !== "string")
			) {
				return `ignoredFoldersByScanner.${scannerId} must be an array of folder paths`;
			}
		}
	}
	return null;
```

- [ ] **Step 7: Pass the record into settings in `makeSettings`**

In `cli/cli.ts`, inside `makeSettings`'s return object (lines 372–395), replace (lines 392–393):

```typescript
		ignoredFolders: options.ignoredFolders,
		ignoreUnresolvedNoteLinks: options.ignoreUnresolvedNoteLinks,
```

with:

```typescript
		ignoredFolders: options.ignoredFolders,
		ignoredFoldersByScanner: options.ignoredFoldersByScanner,
		ignoreUnresolvedNoteLinks: options.ignoreUnresolvedNoteLinks,
```

(This replaces the `DEFAULT_SETTINGS.ignoredFoldersByScanner` inherited by
the spread — without it, the CLI would hash and apply the default empty map
while silently discarding the config. `createScanProfile(scanSettings)` at
line 156 now hashes the effective folders; `ScanRunner` unions them with
`ignoredFolders` per scanner via `getEffectiveIgnoredFolders`. No other
file changes.)

- [ ] **Step 8: Run the focused CLI suite**

```bash
npm test -- src/tests/cli.test.ts
```

Expected: PASS — all four new tests green and every pre-existing CLI test
green unedited (no-config runs still resolve to the empty map, so their
settings and profile hash are unchanged). If any pre-existing test fails,
STOP: the change stopped being behavior-compatible for config-less runs;
fix the implementation, never the pinned test.

---

### Task 4: Document config alignment and lifecycle comparison

**Files:**
- Modify: `README.md`
- Modify: `skills/vault-inspector/SKILL.md`

- [ ] **Step 1: Extend the README config example**

In `README.md`, replace the config JSON block (lines 167–178):

````markdown
```json
{
  "scanners": ["broken-links", "empty-notes", "large-files"],
  "severity": ["error", "warning"],
  "include": ["notes/**"],
  "exclude": ["templates/**"],
  "ignoredFolders": [".trash"],
  "ignoreUnresolvedNoteLinks": true,
  "failOn": "warning",
  "largeMarkdownBytes": 102400
}
```
````

with:

````markdown
```json
{
  "scanners": ["broken-links", "empty-notes", "large-files"],
  "severity": ["error", "warning"],
  "include": ["notes/**"],
  "exclude": ["templates/**"],
  "ignoredFolders": [".trash"],
  "ignoredFoldersByScanner": { "empty-notes": ["drafts"] },
  "ignoreUnresolvedNoteLinks": true,
  "failOn": "warning",
  "largeMarkdownBytes": 102400
}
```
````

- [ ] **Step 2: Add the per-scanner folders paragraph in README**

In `README.md`, immediately after the paragraph ending `update it to `"excalidraw-plugin"`.` (line 194), insert:

```markdown

`ignoredFoldersByScanner` maps scanner IDs to folders that are ignored for
that scanner only, on top of the global `ignoredFolders`. Omitted scanner
keys mean no per-scanner exclusions. Per-scanner folders are detection
inputs: changing them changes `comparison.scanProfile`, so baselines
recorded under different per-scanner folders are reported as not comparable
instead of producing misleading new/resolved counts.
```

- [ ] **Step 3: Rewrite the README baseline section**

In `README.md`, replace the two paragraphs (lines 208–214):

```markdown
Baseline comparison uses issue `fingerprint` values from a previous JSON report.
When `--baseline` is provided, each issue includes `isNew`, and `summary.newIssues`
counts issues not found in the baseline.

CLI baseline comparison is separate from the Obsidian plugin lifecycle. In
version 0.5.0, CLI output does not include plugin scan snapshots, persisting or
resolved lifecycle rows, or the plugin's resolved-history view.
```

with:

```markdown
Baseline comparison uses issue `fingerprint` values from a previous JSON
report. When `--baseline` is provided, each issue includes `isNew`, and
`summary.newIssues` counts issues not found in the baseline. The top-level
`comparison` object describes whether the lifecycle counts are trustworthy:

- `available` — gate on this field. When `false`, the new/persisting/resolved
  counts are zeroed and must not be reported as lifecycle results.
- `mode` — `"profile"` for baselines carrying scan-profile metadata,
  `"legacy"` for older fingerprint-only baselines, `"none"` when no
  `--baseline` was given.
- `reason` — present when `available` is `false`: `missing-baseline`,
  `settings-changed` (the baseline was recorded under different detection
  settings, including `ignoredFoldersByScanner`), or `semantics-changed`
  (the baseline predates current comparison semantics).
- `newIssues`, `persistingIssues`, `resolvedIssues` — lifecycle counts over
  the full unfiltered result when `available` is `true`.

A current-format baseline whose profile or comparison semantics no longer
match is a setup failure: the CLI exits with code `2` (overriding
`--fail-on`, including `none`), omits `isNew` from every issue, and prints a
stderr message naming the reason. Regenerate the baseline or rerun without
`--baseline`. Legacy baselines without comparison metadata still compare
fingerprint-only with a stderr warning recommending regeneration.

CLI baseline comparison is separate from the Obsidian plugin lifecycle. CLI
output does not include plugin scan snapshots or the plugin's
resolved-history view.
```

- [ ] **Step 4: Extend the README exit-code `2` bullet**

In `README.md`, replace (line 220):

```markdown
- `2` — invalid CLI usage or scan setup failure.
```

with:

```markdown
- `2` — invalid CLI usage, scan setup failure, or a `--baseline` file that is
  not comparable (`settings-changed` / `semantics-changed`).
```

- [ ] **Step 5: Extend the skill's stable-field and gating rules**

In `skills/vault-inspector/SKILL.md`, replace (line 17):

```markdown
- Use stable fields for automation: `schemaVersion`, `toolVersion`, `summary`, `scannerId`, `severity`, `classification`, `explanation`, `primaryPath`, `relatedPaths`, `evidence`, `fingerprint`, `fixAction`, `isNew`, and `summary.newIssues`.
```

with:

```markdown
- Use stable fields for automation: `schemaVersion`, `toolVersion`, `summary`, `scannerId`, `severity`, `classification`, `explanation`, `primaryPath`, `relatedPaths`, `evidence`, `fingerprint`, `fixAction`, `isNew`, `summary.newIssues`, and the top-level `comparison` object (`available`, `mode`, `reason`, `newIssues`, `persistingIssues`, `resolvedIssues`).
- Gate baseline interpretation on `comparison.available`. Use `mode` and `reason` for diagnosis, never as pass/fail signals.
```

- [ ] **Step 6: Teach the comparison states in the skill's Baseline Workflow**

In `skills/vault-inspector/SKILL.md`, replace the paragraph (line 82):

```markdown
When a baseline is used, inspect `summary.newIssues` and each issue's `isNew` field. Report new issues before existing known issues. CLI `isNew` is a baseline annotation and is separate from the Obsidian plugin's scan lifecycle. The CLI does not output plugin snapshots or resolved-history rows.
```

with:

```markdown
When a baseline is used, read the top-level `comparison` object first and
interpret it read-only:

- `available: false` — no lifecycle verdict exists. With `reason:
  "missing-baseline"`, state that no baseline was compared. With
  `"settings-changed"` or `"semantics-changed"`, the CLI exits `2`: report
  the setup problem (regenerate the baseline or rerun without `--baseline`)
  and do not present stdout counts as lifecycle results; issues without
  `isNew` are still valid current findings.
- `mode: "legacy"` — counts are fingerprint-only from a pre-comparison
  baseline and a stderr warning recommends regenerating it. Report the
  counts with that caveat.
- `available: true` — report `newIssues` first (triage or fix manually),
  then `persistingIssues` as known debt without re-alerting each one, and
  name the resolved findings confirmed against the baseline. Never edit or
  delete the baseline to make findings disappear; regeneration is a fresh
  `--output` run the user decides on.

CLI `isNew` is a baseline annotation and is separate from the Obsidian
plugin's scan lifecycle. The CLI does not output plugin snapshots or
resolved-history rows.
```

(No other skill changes: the read-only Safety Rules, the `--fix` rejection
rule, and the Exit Codes section already cover this task's remaining
requirements.)

- [ ] **Step 7: Verify the docs build gates are unaffected**

```bash
npm run lint && npm run lint:obsidian-warnings
```

Expected: PASS — documentation files are outside lint scope; this confirms
no code was accidentally touched by the doc edits.

---

### Task 5: Focused verification, full gates, commits, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/cli.test.ts
```

Expected: PASS — per-scanner exclusions affect CLI detection and the scan
profile consistently with the plugin.

- [ ] **Step 2: Build and package checks**

```bash
npm run build
npm pack --dry-run
node cli.js --help
```

Expected: build regenerates usable `main.js` and `cli.js`; `npm pack
--dry-run` lists the same package contents as `main` (documentation changes
do not add or remove packaged files); `--help` prints usage unchanged with
exit `0`. Optionally, against any throwaway vault with `drafts/empty.md`:
a config `{"scanners":["empty-notes"],"ignoredFoldersByScanner":{"empty-notes":["drafts"]}}`
must drop the `drafts/empty.md` finding, and comparing that run against a
no-config baseline must exit `2` with `reason: "settings-changed"`.

- [ ] **Step 3: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0, zero ESLint warnings, full suite green (coverage
thresholds 40/40/50 hold — `cli/cli.ts` gains only covered branches).

- [ ] **Step 4: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `cli/cli.ts`, `src/tests/cli.test.ts`, `README.md`,
`skills/vault-inspector/SKILL.md`, and this plan/spec pair. NOT
`src/settings/*`, `src/scanner/*`, `src/snapshot/*`, `src/report/*`,
`src/fix/*`, `src/main.ts`, `cli/local-vault.ts`, `cli/bin.ts`,
`package.json`, or `styles.css`.

- [ ] **Step 5: Commit the code, then the docs**

```bash
git add cli/cli.ts src/tests/cli.test.ts
git commit -m "feat: align CLI scanner exclusion profiles"
git add README.md skills/vault-inspector/SKILL.md docs/superpowers/specs/2026-09-02-cli-config-alignment-design.md docs/superpowers/plans/2026-09-02-cli-config-alignment.md
git commit -m "docs: explain CLI lifecycle comparison"
git push -u origin feat/cli-config-alignment
```

- [ ] **Step 6: Open the PR** against `main`, titled
  `feat: align CLI scanner exclusion profiles`, covering: the CLI config now
  accepts `ignoredFoldersByScanner` (partial map, validated: unknown scanner
  keys and non-string-array entries reject the config with exit `2`), merged
  over the empty default per key and passed through `makeSettings` into the
  existing profile/scan machinery (no `settings.ts`/`scan-profile.ts`
  changes needed — documented roadmap file-list deviation); per-scanner
  folders change `comparison.scanProfile`, so stale baselines fail with
  exit `2` `settings-changed` instead of false deltas; README documents the
  config key and rewrites the baseline section for profile-aware
  comparison (modes, reasons, exit-`2` contract, legacy behavior, `isNew`
  retention); the Agent Skill teaches unavailable / legacy / new /
  persisting / resolved interpretation read-only; `--fix` still rejected;
  CLI remains read-only. Include the roadmap PR-description items: focused
  tests run, full verification results, non-goals, compatibility impact,
  manual validation performed, and remaining detection boundaries. Note
  that this closes Milestone 4 and completes the roadmap.

## Self-review checklist (completed during plan writing)

- Roadmap Task 4.3 requirement ↔ implementation mapping: accept per-scanner ignored folders in the JSON config ✓ (Task 3 Steps 4–6: `CliConfig` intersection adds `ignoredFoldersByScanner?: Partial<Record<ScannerId, string[]>>`, `validateConfig` rejects unknown keys and wrong-typed entries on the existing exit-2 path); include effective per-scanner folders in the CLI scan profile ✓ (Task 3 Steps 3/5/7: `parseArgs` defaults to `createEmptyIgnoredFoldersByScanner()`, `loadConfig` spreads config over it, `makeSettings` passes it into `InspectorSettings`; `createScanProfile` — already called at `cli/cli.ts` line 156 — hashes it, pinned end to end by the profile-change test asserting exit `2` + `reason: "settings-changed"`); document profile-aware baselines and legacy behavior ✓ (Task 4 Steps 3–4 rewrite README's baseline section and exit-code bullet; Steps 1–2 document the new config key); keep skill guidance read-only and teach comparison states ✓ (Task 4 Steps 5–6 add the `available` gating rule and the unavailable/legacy/new/persisting/resolved interpretation, all read-only, `--fix` rule untouched); continue rejecting `--fix` ✓ (no code touches the `parsed.fix` guard at `cli/cli.ts` lines 132–139; docs must not present it as available — ground rule).
- Roadmap focused verification reproduced: `npm test -- src/tests/cli.test.ts`, `npm run build`, `npm pack --dry-run` (Task 5 Steps 1–2), plus the repository's full gates.
- No placeholders: every step quotes complete replacement code or markdown anchored to current file lines; all four new tests are fully written with determined fixture arithmetic (drafts excluded for empty-notes only → exactly 2 surviving issues; config-only profile change → exit `2` under `--fail-on none`; typo'd key `"empty-note"` → exact error string; string value `"drafts"` → exact error string).
- Type/name consistency verified against real code: config key `ignoredFoldersByScanner` matches `InspectorSettings.ignoredFoldersByScanner` (`src/settings/settings.ts` line 20); `createEmptyIgnoredFoldersByScanner` is exported from `src/settings/settings.ts` (line 30); `SCANNER_IDS` and `ScannerId` are already imported in `cli/cli.ts` (lines 4–5); `CliOptions` already has `ignoredFolders: string[]` at line 78 and `makeSettings` already sets `ignoredFolders` at line 392 (both anchors used); existing config validation style (`Unknown scanner:`, `ignoreUnresolvedNoteLinks must be a boolean`) extended in place; `createScanProfile` normalization of per-scanner folders (`normalizeFolders` per scanner) pinned by `src/tests/scan-profile.test.ts` lines 24, 30–39, 109 — no changes needed there; `comparisonVersion: 2` in the profile-change test matches `COMPARISON_VERSION` pinned by the existing cli tests.
- Config-vs-defaults precedence audited: every other config key resolves per key (`args.x ?? config.x`); the new key follows the same per-key spread, and since the CLI has no flag form, `args.ignoredFoldersByScanner` is always the empty map — no flags-vs-config ambiguity exists.
- Bit-compatibility for config-less runs audited: without `--config` or without the key, `options.ignoredFoldersByScanner === createEmptyIgnoredFoldersByScanner()`, the exact value `DEFAULT_SETTINGS` spread previously supplied, so `makeSettings` output, `createScanProfile` hash, and every pre-existing cli test are unchanged.
- Baseline-mismatch path audited: the profile-change test rides the merged Task 4.2 flow (`readBaseline` → `resolveBaselineCompatibility` → forced exit `2`, zero counts, no `isNew`); the expected `comparison` object matches the shape asserted by the existing mismatch tests in `src/tests/cli.test.ts`.
- Documentation anchors audited: README config block is lines 167–178, the `excalidraw-plugin` paragraph ends at line 194, the baseline paragraphs are lines 208–214, and the exit-`2` bullet is line 220; SKILL.md's stable-fields line is 17 and the Baseline Workflow paragraph is line 82 — all replaced with content that quotes only fields that actually exist in the payload (`comparison` shape from `CliComparison`, `cli/cli.ts` lines 42–51).
- Obsidian lint constraints: the only `src/` file touched is `src/tests/cli.test.ts` (Node-free, test-only); `cli/` is outside the `lint:obsidian-warnings` `src/**` scope; no new `obsidian` imports; no `eslint-disable`.
- Precision-suite/CLI impact: precision suite untouched (no scanner, runner, snapshot, or profile-code changes); CLI compatibility additive — no flag, stable-field, or exit-code change for existing configs; the first new behavior an adopting user sees is the mandated honest `settings-changed` exit `2` telling them to regenerate their baseline.
