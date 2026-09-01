# CLI Config Alignment Design (Milestone 4, Task 4.3)

Date: 2026-09-02
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 4, Task 4.3 — final task of the roadmap)
Predecessors: `docs/superpowers/specs/2026-09-02-cli-profile-metadata-design.md` (Task 4.1, merged — `CliComparison`, `createScanProfile` in the CLI payload, `isNew` retention), `docs/superpowers/specs/2026-09-02-cli-baseline-comparison-design.md` (Task 4.2, merged — `readBaseline`/`BaselineReport`, `resolveBaselineCompatibility`, `mode: profile/legacy/none`, mismatch exit `2`), `docs/superpowers/specs/2026-07-27-issue-100-scanner-exclusions-duplicate-keep-design.md` (merged — `ignoredFoldersByScanner: Record<ScannerId, string[]>` and `createEmptyIgnoredFoldersByScanner` in the plugin)

## Problem

The plugin can scope folder exclusions per scanner (`settings.ignoredFoldersByScanner`), and `ScanRunner` merges them with global folders via `getEffectiveIgnoredFolders` before each scanner runs (`src/scanner/ScanRunner.ts` lines 110–116). The CLI cannot express this at all:

- **The JSON config rejects nothing and accepts nothing for per-scanner folders.** `CliConfig` in `cli/cli.ts` (lines 298–319) whitelists option keys, and `ignoredFoldersByScanner` is not among them; `makeSettings` (lines 365–396) spreads `DEFAULT_SETTINGS`, whose `ignoredFoldersByScanner` is `createEmptyIgnoredFoldersByScanner()`. Every CLI scan therefore runs with zero per-scanner exclusions, so a vault that relies on "ignore `drafts/` for empty-notes only" in the plugin gets different findings from the CLI.
- **The CLI scan profile cannot distinguish those runs.** `createScanProfile` already hashes `ignoredFoldersByScanner` per scanner (`src/scanner/scan-profile.ts` lines 20–25), and the CLI already computes and emits the profile (Task 4.1). But because the CLI's effective per-scanner folders are always empty, a plugin user porting their settings to a CLI config silently changes detection inputs without the profile — or the baseline comparison — surfacing it.
- **The lifecycle comparison semantics shipped in Tasks 4.1/4.2 are undocumented.** README's baseline section (lines 208–214) still describes 0.5.0 behavior ("does not include persisting or resolved lifecycle rows") and documents only fingerprint/`isNew` semantics; the `comparison` object, the `profile`/`legacy`/`none` modes, the `settings-changed`/`semantics-changed` mismatch reasons, and the exit-`2` setup-failure contract exist only in code. The Agent Skill (`skills/vault-inspector/SKILL.md`) likewise teaches only `isNew`/`summary.newIssues` and gives an agent no rule for the unavailable / legacy / new / persisting / resolved states.

## Goals

The roadmap's required behavior, restated as where each guarantee lives:

- **Accept per-scanner ignored folders in the JSON config.** `CliConfig` gains
  `ignoredFoldersByScanner?: Partial<Record<ScannerId, string[]>>`. The key
  name matches the plugin setting exactly (`ignoredFoldersByScanner`) and the
  config-file convention of camelCase option names, so a plugin user can copy
  their per-scanner map into the config verbatim. Config files are partial by
  design: any scanner key may be omitted, and omitted keys mean "no
  per-scanner exclusions for that scanner" — identical to
  `createEmptyIgnoredFoldersByScanner()`. Validation (in `validateConfig`,
  which already validates `scanners`/`severity`/`failOn` shapes):
  an unknown scanner key rejects the config (`Unknown scanner in
  ignoredFoldersByScanner: <key>`); a non-array or non-string-entry value
  rejects it (`ignoredFoldersByScanner.<id> must be an array of folder
  paths`). Both ride the existing `loadConfig` error path: exit `2`, empty
  stdout, message on stderr — the same contract as `Unknown scanner:` for
  `scanners` today.

- **Include effective per-scanner folders in the CLI scan profile.** There is
  no `--ignore-folder-for` flag in this task (roadmap lists none; flags stay
  untouched). The flow is: `loadConfig` merges the config's partial map over
  `createEmptyIgnoredFoldersByScanner()` into
  `options.ignoredFoldersByScanner` (a full `Record<ScannerId, string[]>`,
  always defined, defaulting to the empty map when no config provides one);
  `makeSettings` passes that record into `InspectorSettings`. From there the
  existing machinery does the work with zero further changes:
  `createScanProfile` normalizes and hashes it (`normalizeFolders` per
  scanner — trailing slashes stripped, duplicates removed, sorted), and
  `ScanRunner` applies `getEffectiveIgnoredFolders(global, perScanner)` to
  each scanner's `ScanContext`. Consequences, all desired: two runs with
  different per-scanner folders produce different `comparison.scanProfile`;
  a baseline recorded without per-scanner folders compared against a run
  with them is a `settings-changed` mismatch (exit `2`) instead of a flood
  of false new/resolved findings — exactly the Task 4.2 contract now
  exercised by real detection-input changes.

- **Document profile-aware baselines and legacy behavior.** README's baseline
  section (lines 208–214) is rewritten to document: the `comparison` object
  and its stable shape; the three modes (`profile`, `legacy`, `none`) and
  gating rule ("gate on `available`, use `mode`/`reason` for diagnosis");
  the mismatch reasons `settings-changed`/`semantics-changed` with exit `2`
  overriding `--fail-on` including `none`; the legacy path (pre-comparison
  baselines compare fingerprint-only with a stderr warning; regenerate to
  upgrade); `isNew` retention (kept for comparable scans, omitted under a
  mismatch); and the exit-code list (line 216–220) gains the
  not-comparable-baseline case. The config example (lines 167–178) gains
  `ignoredFoldersByScanner`, and a short paragraph after the
  "Settings omitted…" note (lines 190–194) explains per-scanner folders are
  unioned with global `ignoredFolders` and change the scan profile.

- **Keep Agent Skill guidance read-only and teach comparison states.**
  `skills/vault-inspector/SKILL.md` gains, inside the existing structure: a
  Safety Rule addition naming `comparison` (with
  `available`/`mode`/`reason`/counts) as stable automation fields and
  restating "gate on `available`"; and an extension of the Baseline Workflow
  section that teaches an agent to interpret each state —
  **unavailable** (`available: false`: no baseline, or exit-`2` mismatch
  with a `reason`; do not report lifecycle counts), **legacy**
  (fingerprint-only counts plus a stderr warning; recommend regenerating),
  and the counts themselves — **new** findings first (fix or triage),
  **persisting** (known debt; summarize, do not re-alert as new),
  **resolved** (confirm the fix, read-only: never delete the baseline to
  "handle" findings). The skill's read-only rules and the `--fix` rejection
  rule are unchanged and still authoritative; no command in the skill gains
  write capability.

- **Continue rejecting `--fix` as unsupported.** Untouched: the
  `parsed.fix` guard in `runCli` (exit `2`, "CLI fix execution is not
  available yet."), the README paragraph (lines 224–225), and the skill's
  Safety Rule. Documentation edits must not present fix execution as
  available.

### Interpretation decisions (documented, not accidental)

- **Config key name is `ignoredFoldersByScanner`, value is a partial map.**
  Matching the plugin setting name keeps copy-paste portability; partial
  (not full-record) because every other config key is optional and a config
  that must list all eight scanners to exclude one folder would be hostile.
  Unknown keys are rejected rather than ignored: a typo
  (`"empty-note"`) would otherwise silently re-enable findings the user
  believes excluded — the same reason `scanners` validation rejects unknown
  IDs.
- **No merge between CLI flags and config for this option.** There is no
  flag form, so the only precedence question is config-vs-default, answered
  by "config wins, per key, over the empty map". This mirrors
  `ignoredFolders`'s existing "flags override config" behavior without
  inventing a flag.
- **`settings.ts` and `scan-profile.ts` need no code changes.** The roadmap
  lists both as "Modify", but the per-scanner shape
  (`Record<ScannerId, string[]>`, `createEmptyIgnoredFoldersByScanner`), the
  `ScanRunner` propagation, and the profile hash already exist from the
  issue-100 work. This task only feeds the CLI config through them. The
  verification that per-scanner folders are detection inputs (not
  presentation settings) is `scan-profile.ts`'s canonical object including
  them and `scan-profile.test.ts`'s "changes when per-scanner ignored
  folders changes" case (line 109).
- **Documentation claims both commits.** The roadmap's milestone-4 commit
  list separates `feat: align CLI scanner exclusion profiles` (code) from
  `docs: explain CLI lifecycle comparison` (README + skill), so this task
  ships two commits on one branch: code first, documentation second.

## Non-goals (this PR)

- No new CLI flags (no `--ignore-folder-for`); `--help`/usage text unchanged.
- No change to scanner behavior, `ScanRunner`, `ScanContext`, fingerprints,
  or snapshot shape — per-scanner exclusions are already implemented there.
- No change to `DEFAULT_SETTINGS`, the settings tab, or any plugin UI.
- No change to stable JSON output keys, `summary` computation, markdown
  output, or stdout-JSON/stderr discipline; `comparison` gains no new fields
  (it already carries everything the documentation describes).
- No CLI mutation or fix execution; `--fix` keeps exiting `2`.
- No baseline auto-regeneration, migration, or statefulness — the CLI stays
  stateless; regenerating a baseline remains a manual `--output` run.

## Design

### `CliConfig` and validation (`cli/cli.ts`)

```ts
type CliConfig = Partial<
	Pick<
		CliOptions,
		| "scanners"
		| ...unchanged keys...
	>
> & {
	ignoredFoldersByScanner?: Partial<Record<ScannerId, string[]>>;
};
```

`validateConfig` gains, after the `ignoreUnresolvedNoteLinks` check:

```ts
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
```

### `CliOptions`, `loadConfig`, `makeSettings` (`cli/cli.ts`)

- `CliOptions` gains `ignoredFoldersByScanner: Record<ScannerId, string[]>`
  (required, always populated).
- `parseArgs`'s `options` initializer gains
  `ignoredFoldersByScanner: createEmptyIgnoredFoldersByScanner()`; the import
  from `../src/settings/settings` extends to
  `createEmptyIgnoredFoldersByScanner`.
- `loadConfig` gains:

```ts
ignoredFoldersByScanner: config.ignoredFoldersByScanner
	? { ...args.ignoredFoldersByScanner, ...config.ignoredFoldersByScanner }
	: args.ignoredFoldersByScanner,
```

  (validated already; spread over the empty map so omitted scanner keys stay
  `[]`).

- `makeSettings` replaces the inherited default with the resolved value:

```ts
ignoredFoldersByScanner: options.ignoredFoldersByScanner,
```

`createScanProfile(scanSettings)` (already called at `cli/cli.ts` line 156)
now hashes the effective per-scanner folders automatically; nothing else in
the scan or comparison pipeline changes.

### README (`README.md`)

- Config example: add `"ignoredFoldersByScanner": { "empty-notes": ["drafts"] }`
  to the JSON block (lines 167–178).
- After the "Settings omitted…" paragraph (lines 190–194): a short paragraph —
  per-scanner ignored folders are unioned with global `ignoredFolders` for
  that scanner only; keys are scanner IDs; changing them changes
  `comparison.scanProfile`, so baselines recorded under different
  per-scanner folders are not comparable.
- Baseline section (lines 208–214): rewrite to describe the `comparison`
  object — `available` gating, modes `profile`/`legacy`/`none`, reasons
  `missing-baseline`/`settings-changed`/`semantics-changed`, exit `2`
  overriding `--fail-on` (including `none`) for current-format mismatches,
  the legacy fingerprint-only mode with its stderr warning and regeneration
  path, `isNew` retention for comparable scans and its omission under a
  mismatch, and new/persisting/resolved counts covering the full unfiltered
  result.
- Exit-code list (lines 216–220): extend the `2` bullet with "or the
  `--baseline` file is not comparable (`settings-changed` /
  `semantics-changed`)".

### Agent Skill (`skills/vault-inspector/SKILL.md`)

- Safety Rules: add `comparison` (`available`, `mode`, `reason`, count
  fields) to the stable-fields sentence, plus one rule: "Gate baseline
  interpretation on `comparison.available`; use `mode` and `reason` for
  diagnosis, never as pass/fail signals."
- Baseline Workflow: replace the paragraph at line 82 with comparison-state
  guidance — unavailable (report the reason; for mismatch reasons exit is
  `2` and stdout must not be read as a lifecycle verdict), legacy (counts
  are fingerprint-only; recommend regenerating the baseline), and for
  available runs: report **new** findings first, summarize **persisting**
  findings as known debt without re-alerting, and confirm **resolved**
  findings by naming the previously reported fingerprint/path — all
  read-only; never edit or delete the baseline to make findings disappear.
- No changes to the read-only rules, `--fix` rule, or exit-code section
  beyond what the states require (`2` already covered).

## Documented deviations from the roadmap file list

- `src/settings/settings.ts` is NOT modified:
  `ignoredFoldersByScanner: Record<ScannerId, string[]>` and
  `createEmptyIgnoredFoldersByScanner()` already exist (lines 20, 30–35, 54).
- `src/scanner/scan-profile.ts` is NOT modified: `createScanProfile` already
  normalizes and hashes per-scanner folders (lines 20–25), pinned by
  `src/tests/scan-profile.test.ts`.
- `cli/cli.ts`, `src/tests/cli.test.ts`, `README.md`, and
  `skills/vault-inspector/SKILL.md` are modified as listed.

## Test strategy

`src/tests/cli.test.ts` (extend, no new file):

- **New** `"loads per-scanner ignored folders from config"`: vault
  `{ "drafts/empty.md": "", "drafts/large.md": "x".repeat(30),
  "active/empty.md": "" }`; config `{ scanners: ["empty-notes",
  "large-files"], largeMarkdownBytes: 10, ignoredFoldersByScanner:
  { "empty-notes": ["drafts"] } }`. Expect exactly two issues: empty-notes
  on `active/empty.md` and large-files on `drafts/large.md` — proving the
  exclusion is scoped to empty-notes and does not affect large-files in the
  same folder.
- **New** `"changes the scan profile when per-scanner folders change"`: same
  vault, first run without per-scanner folders writes a baseline; second
  run adds `ignoredFoldersByScanner` via config with `--baseline`. Expect
  exit `2`, `payload.comparison.reason` `"settings-changed"`, stderr
  containing `settings-changed` — pinning that effective per-scanner
  folders are profile detection inputs end to end.
- **New** `"rejects an unknown scanner in ignoredFoldersByScanner"`:
  config `{ ignoredFoldersByScanner: { "empty-note": ["drafts"] } }` →
  exit `2`, empty stdout, stderr containing
  `Unknown scanner in ignoredFoldersByScanner: empty-note`.
- **New** `"rejects a non-array ignoredFoldersByScanner entry"`: config
  `{ ignoredFoldersByScanner: { "empty-notes": "drafts" } }` → exit `2`,
  stderr containing
  `ignoredFoldersByScanner.empty-notes must be an array of folder paths`.

`src/tests/scan-profile.test.ts`: unchanged — it already pins that
per-scanner ignored folders change the profile (line 109) and normalize
independently of key order (lines 24, 30–39).

## Verification strategy

```bash
npm test -- src/tests/cli.test.ts
npm run build
npm pack --dry-run
npm run lint && npm run lint:obsidian-warnings && npm test
```

Expected: the npm CLI package and the repository Agent Skill expose the same
documented lifecycle semantics without gaining mutation capability.

## Precision-suite and CLI impact

- **Precision suite: none.** Scanners, `ScanRunner`, fingerprints,
  `src/scanner/scan-profile.ts`, and snapshot shape are untouched. The only
  `src/` change is zero — all code changes live in `cli/cli.ts` and its
  tests.
- **CLI compatibility: additive.** No stable field, exit code, or flag
  changes. Runs without a config (or without
  `ignoredFoldersByScanner` in it) are bit-identical: the option defaults to
  the empty map, producing the same settings and the same
  `createScanProfile` hash as today (the profile hash of the empty map is
  what the CLI already emits). New behavior appears only for configs that
  opt in — and the first thing opting-in users with existing baselines will
  see is an honest exit-`2` `settings-changed` mismatch telling them to
  regenerate, which is the roadmap's required guardrail.
- **Roadmap closure:** this is Milestone 4's final task; on merge, every
  milestone-4 acceptance criterion is met (legacy baselines readable,
  mismatches never produce false counts, stable fields compatible,
  per-scanner exclusions consistent across plugin and CLI, CLI read-only).

## Risks

- **Users with existing baselines who add per-scanner folders get exit `2`.**
  Deliberate and correct: their comparison would otherwise report false
  lifecycle deltas. The stderr message and `comparison.reason` name the fix
  (regenerate the baseline). README documents this.
- **Partial-map semantics could be misread as merge-with-plugin-settings.**
  The CLI never reads plugin settings; `ignoredFoldersByScanner` in a config
  is the complete per-scanner map for the run. README's wording states
  omitted keys mean no per-scanner exclusions.
- **Skill bloat.** The comparison-state guidance is kept to one Safety Rule
  and one rewritten Baseline Workflow paragraph; the skill stays under its
  current review-friendly size.
