# Vault Inspector Core Maintenance Deepening Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen Vault Inspector's existing eight-scanner maintenance workflow by reducing false positives, making destructive actions safer, strengthening repeat-scan value, and aligning CLI lifecycle semantics without expanding the product into new scanner categories.

**Architecture:** Preserve `ScanRunner`, `ScanContext`, deterministic issue fingerprints, the report view, verified fix pipeline, and read-only CLI as the primary boundaries. Deliver the roadmap as five independently releasable milestones: establish measurable precision fixtures, build a shared reference model and refine current scanners, add action-impact policy, add bounded history and conservative automatic scans, then bring compatible lifecycle comparison to the CLI.

**Tech Stack:** TypeScript, Obsidian Plugin API, Node.js CLI, esbuild, Vitest, ESLint, Markdown, GitHub Actions

---

## Plan status and execution contract

This is the umbrella implementation roadmap for work after version `0.6.0`.
The scope crosses scanner semantics, mutation policy, plugin persistence,
background orchestration, and the public CLI protocol. Each milestone must
therefore receive its own approved design document and code-level implementation
plan before implementation begins.

The delivery order is mandatory:

```text
precision baseline
  -> scanner precision
  -> action safety
  -> change awareness and recurrence
  -> CLI lifecycle parity
```

Do not start automatic scans, scan history, or CLI lifecycle output while the
precision milestone is incomplete. More frequent scans would otherwise amplify
known uncertainty in orphan, duplicate, empty-note, and external-link findings.

## Product boundary

### Included

- Improve the existing eight scanners without adding scanner IDs.
- Reduce false positives in broken links, orphan attachments, empty notes,
  external links, and duplicate files.
- Reuse one reference index across detection and action-impact previews.
- Preserve the `confirmed`, `candidate`, and `unverified` interpretation model.
- Make candidate and destructive actions require proportionate review.
- Preserve preflight scans and post-action verification.
- Add bounded summary history and an opt-in stale-scan trigger.
- Add profile-aware new, persisting, and resolved comparison to the CLI.
- Keep old stable CLI fields and legacy baseline input readable.

### Excluded

- New scanner categories.
- Real-time file watching or a background daemon.
- Cloud accounts, sync, remote storage, or telemetry.
- Automatic cleanup without confirmation.
- Automatic duplicate-reference rewrites.
- CLI mutation or fix execution.
- Full scan-history browsing, arbitrary snapshot selection, charts, or analytics.
- UI localization or an i18n framework.
- A monorepo split or unrelated architecture rewrite.

## Delivery map

| Milestone | Outcome | Primary boundary | Release gate |
| --- | --- | --- | --- |
| 0. Precision baseline | False-positive work becomes measurable | Test fixtures and benchmarks | Current behavior captured and all tests pass |
| 1. Scanner precision | Current findings become more accurate and explainable | `ScanRunner`, `ScanContext`, current scanners | Supported references do not produce known false positives |
| 2. Action safety | Users see impact before a mutation and risky candidates cannot be bulk-fixed silently | `FixAction`, confirmation, runner, executor | Every mutation is reviewed, preflighted, and verified |
| 3. Change awareness | Repeat scans emphasize changes and can run conservatively when stale | Snapshot persistence and scan orchestration | History remains bounded and automatic scans stay opt-in/read-only |
| 4. CLI parity | CI gets profile-aware lifecycle results without losing compatibility | CLI JSON, baseline loader, exit policy | Stable fields remain compatible and mismatches never create false deltas |

## Cross-cutting engineering rules

- Implement scanner changes one scanner per commit.
- Write a failing focused test before changing scanner or fix behavior.
- Preserve deterministic fingerprints unless the finding identity genuinely
  changes; increment `COMPARISON_VERSION` when new detection semantics would
  make old snapshots misleading.
- Keep scanner logic in `src/scanner/scanners/` and shared pure logic in focused
  modules under `src/scanner/` or `src/utils/`.
- Do not couple scanners directly to report DOM code.
- Keep CLI scans read-only and keep JSON stdout free of progress or warnings.
- Never disable an `obsidianmd/*` ESLint rule.
- Do not bump the package version in implementation PRs. Prepare releases in a
  separate release PR after implementation merges and CI is green.

## Milestone 0: Establish a precision and performance baseline

### Task 0.1: Build a reusable precision fixture vault

**Files:**

- Create: `src/tests/fixtures/precision-vault/`
- Create: `src/tests/helpers/fixture-vault.ts`
- Create: `src/tests/scanner-precision.test.ts`
- Modify: `src/tests/helpers/scan-context.ts`
- Reference: `cli/local-vault.ts`

- [ ] Add fixture notes covering valid and invalid Wiki Links, Markdown links,
  embeds, aliases, headings, relative paths, and Unicode paths.
- [ ] Add fixture attachments referenced from Markdown, frontmatter, and Canvas,
  plus truly unreferenced attachments.
- [ ] Add duplicate groups covering hash-identical, same-name/different-content,
  same-size/different-content, and files above the hash cap.
- [ ] Add notes covering prose, link-only MOCs, embeds, task lists, code blocks,
  frontmatter-only notes, title-only notes, and genuine stubs.
- [ ] Add external-link fixtures through injected request adapters rather than
  public network calls.
- [ ] Implement `loadFixtureVault()` in `src/tests/helpers/fixture-vault.ts` so
  plugin scanner tests and CLI tests can consume the same vault-relative files.
- [ ] Assert for every case whether a finding exists, its severity,
  classification, key evidence, action availability, and fingerprint stability.

Run:

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: the fixture suite passes against the documented `0.6.0` behavior and
records intentional candidates without claiming unsupported certainty.

### Task 0.2: Record a non-network scan performance baseline

**Files:**

- Create: `scripts/benchmark-scan.mjs`
- Create: `src/tests/scan-performance.test.ts`
- Modify: `package.json`

- [ ] Add a deterministic synthetic-vault generator that creates configurable
  counts of Markdown notes and attachments in a temporary directory.
- [ ] Run all default scanners except external links through the shipped CLI
  adapter.
- [ ] Report file count, issue count, total duration, and files read for hashing.
- [ ] Add an npm script named `benchmark:scan` that invokes the benchmark without
  downloading dependencies or writing inside a user vault.
- [ ] Add a generous regression assertion suitable for CI and keep the tighter
  15% comparison as a local before/after review gate.

Run:

```bash
npm run benchmark:scan
npm test -- src/tests/scan-performance.test.ts
```

Expected: both commands exit `0`; the output becomes the comparison baseline for
the shared reference-index work.

### Milestone 0 acceptance

- [ ] Existing tests and the new precision suite pass.
- [ ] Supported reference paths have explicit true-positive and negative cases.
- [ ] Candidate and unverified cases name their detection boundary.
- [ ] No production telemetry or runtime dependency is introduced.
- [ ] Benchmark output is reproducible from a clean checkout.

Suggested branch: `feat/scanner-precision-foundation`

Suggested commits:

```text
test: add scanner precision fixture vault
test: add repeatable scan performance baseline
```

## Milestone 1: Reduce false positives in current scanners

Milestone 1 must be split into separate code-level plans and PRs. The shared
reference index lands first; scanner refinements consume it afterward.

### Task 1.1: Build one shared reference index

**Files:**

- Create: `src/scanner/reference-index.ts`
- Create: `src/tests/reference-index.test.ts`
- Modify: `src/scanner/ScanContext.ts`
- Modify: `src/scanner/ScanRunner.ts`
- Modify: `cli/local-vault.ts`
- Modify: `src/tests/helpers/scan-context.ts`

Define a pure reference model with these responsibilities:

- Resolve Markdown links, Wiki Links, embeds, and frontmatter links.
- Read Obsidian Canvas JSON and collect `file` node references.
- Record inbound reference count and source kinds for each vault path.
- Record coverage failures without throwing away an otherwise successful scan.
- Expose enough information for orphan detection, duplicate keep decisions, and
  deletion-impact previews.

Required behavior:

- [ ] `ScanRunner` builds the index once per scan and passes it through
  `ScanContext`.
- [ ] Malformed Canvas data produces structured coverage failure data.
- [ ] The CLI and plugin use the same reference semantics.
- [ ] CSS, Dataview dynamic queries, publishing tools, and external applications
  remain named boundaries rather than inferred references.
- [ ] Reference-index construction does not mutate vault files.

Focused verification:

```bash
npm test -- src/tests/reference-index.test.ts src/tests/scan-runner.test.ts
npm run benchmark:scan
```

Expected: Canvas and Markdown references resolve consistently, malformed Canvas
files do not fail the scan, and scan time remains within the accepted baseline.

Suggested branch: `feat/reference-index`

### Task 1.2: Deepen orphan-attachment detection

**Files:**

- Modify: `src/scanner/scanners/orphan-attachments.ts`
- Modify: `src/tests/orphan-attachments.test.ts`
- Modify: `src/report/render-issues.ts`
- Modify: `src/report/markdown-export.ts`

Required behavior:

- [ ] Consume the shared reference index instead of rebuilding Markdown-only
  reference state.
- [ ] Treat Canvas-referenced attachments as referenced.
- [ ] Include file size, last modification time, reference sources, and coverage
  completeness in evidence.
- [ ] Keep orphan findings classified as `candidate` because external reference
  channels remain outside the scan boundary.
- [ ] Emit an `unverified` coverage finding when Canvas parsing is incomplete.
- [ ] Prevent orphan-delete eligibility while reference coverage is incomplete.
- [ ] Preserve the lower severity for recently modified files.

Focused verification:

```bash
npm test -- src/tests/orphan-attachments.test.ts src/tests/scanner-precision.test.ts
```

Expected: known Markdown, frontmatter, and Canvas references do not produce
orphan findings; malformed Canvas coverage never authorizes deletion.

Suggested commit:

```text
fix: reduce orphan attachment false positives
```

### Task 1.3: Deepen duplicate-file evidence and keep decisions

**Files:**

- Modify: `src/scanner/scanners/duplicate-files.ts`
- Modify: `src/tests/duplicate-files.test.ts`
- Modify: `src/fix/fix-decisions.ts`
- Modify: `src/fix/confirm-modal.ts`
- Modify: `src/tests/fix-decisions.test.ts`
- Modify: `src/tests/confirm-modal.test.ts`

Required behavior:

- [ ] Preserve the size prefilter and size-capped SHA-256 design.
- [ ] Add evidence identifying `hash-confirmed`, `cap-exceeded`, and `read-failed`
  states.
- [ ] Include inbound reference counts and last modification times for each file.
- [ ] In automatic keep mode, keep the path with the highest inbound reference
  count; break equal-count ties by stable vault-relative path order.
- [ ] When multiple duplicate paths have inbound references, show the impact and
  require explicit review before trashing any path.
- [ ] Do not rewrite references automatically.

Focused verification:

```bash
npm test -- src/tests/duplicate-files.test.ts src/tests/fix-decisions.test.ts src/tests/confirm-modal.test.ts
```

Expected: only hash-identical groups are confirmed duplicates, keep selection is
deterministic, and referenced duplicates cannot be silently trashed.

Suggested commit:

```text
fix: improve duplicate file decisions
```

### Task 1.4: Make empty-note detection structure-aware

**Files:**

- Modify: `src/scanner/scanners/empty-notes.ts`
- Modify: `src/tests/empty-notes.test.ts`
- Modify: `src/tests/scanner-precision.test.ts`

Count meaningful structures independently from prose word count:

- internal links and embeds;
- Markdown task items;
- non-empty list items;
- non-empty fenced code blocks;
- other visible block content after frontmatter and title removal.

Required behavior:

- [ ] Link-only MOCs, embed-only notes, and task notes are not reported as empty.
- [ ] Title-only and frontmatter-only notes remain candidates.
- [ ] Evidence includes word count, meaningful structure count, and inbound
  reference count.
- [ ] A heavily referenced stub remains reviewable but cannot be treated as a
  low-risk bulk-delete candidate.
- [ ] CJK word-count behavior remains covered.

Focused verification:

```bash
npm test -- src/tests/empty-notes.test.ts src/tests/scanner-precision.test.ts
```

Expected: structural notes are preserved while genuine empty notes and stubs are
still detected.

Suggested commit:

```text
fix: recognize meaningful note structures
```

### Task 1.5: Preserve display text when fixing broken links

**Files:**

- Modify: `src/scanner/scanners/broken-links.ts`
- Modify: `src/scanner/Issue.ts`
- Modify: `src/fix/fix-executor.ts`
- Modify: `src/tests/broken-links.test.ts`
- Modify: `src/tests/fix-executor.test.ts`

Required transformations:

```text
[[Missing|Readable label]] -> Readable label
[[Missing]]                -> Missing
[Readable label](missing)  -> Readable label
![[missing.png]]           -> removed embed
```

Required behavior:

- [ ] Preserve original syntax and replacement text in structured fix metadata.
- [ ] Continue protecting fenced code, inline code, and HTML comments.
- [ ] Distinguish missing notes, attachments, headings, normal links, and embeds
  in evidence.
- [ ] Preserve `ignoreUnresolvedNoteLinks` semantics for plain note Wiki Links.
- [ ] Do not offer a replacement action when the original source range cannot be
  identified unambiguously.

Focused verification:

```bash
npm test -- src/tests/broken-links.test.ts src/tests/fix-executor.test.ts
```

Expected: supported fixes preserve readable content and never modify protected
Markdown regions.

Suggested commit:

```text
fix: preserve labels when removing broken links
```

### Task 1.6: Classify external-link outcomes accurately

**Files:**

- Modify: `src/scanner/scanners/external-links.ts`
- Modify: `cli/public-http.ts`
- Modify: `src/main.ts`
- Modify: `src/tests/external-links.test.ts`
- Modify: `src/tests/public-http.test.ts`
- Modify: `src/tests/cli.test.ts`

Status policy:

| Result | Presentation |
| --- | --- |
| 404 or 410 | Candidate dead link |
| 401 or 403 | Access-restricted, not dead |
| 429 | Rate-limited, not dead |
| 5xx | Candidate temporary server failure |
| Timeout or request failure | Unverified |
| Safety-policy block | Unverified and blocked |

Required behavior:

- [ ] Replace the status-only request adapter with a method-aware result contract.
- [ ] Use HEAD first and a bounded Range GET fallback only for 405 or 501.
- [ ] Never retain response bodies.
- [ ] Re-run URL, DNS, redirect, and public-IP checks for every fallback and
  redirect destination.
- [ ] Preserve the five-second per-request timeout, sixty-second scan budget, and
  five-request batching limit unless focused performance evidence justifies a
  separate design change.
- [ ] Keep external-link scanning disabled by default.

Focused verification:

```bash
npm test -- src/tests/external-links.test.ts src/tests/public-http.test.ts src/tests/cli.test.ts
```

Expected: access-control, rate-limit, and temporary server responses are no
longer called dead links; HEAD fallback cannot bypass SSRF protections.

Suggested branch: `fix/external-link-classification`

Suggested commit:

```text
fix: classify external link failures accurately
```

### Milestone 1 acceptance

- [ ] Supported Canvas references do not produce orphan findings.
- [ ] Malformed reference sources cannot authorize destructive actions.
- [ ] Link-only MOCs and task notes are not empty-note candidates.
- [ ] Only hash-confirmed groups are presented as confirmed duplicates.
- [ ] 401, 403, 429, and 5xx are not uniformly labeled as dead links.
- [ ] Broken-link fixes preserve user-visible labels.
- [ ] Each scanner change has its own commit and focused tests.
- [ ] The non-network benchmark remains within 15% of the Milestone 0 baseline,
  or the PR documents measured evidence for accepting a different bound.

## Milestone 2: Add action-impact policy and safer batch review

### Task 2.1: Extend fix actions with additive eligibility and impact metadata

**Files:**

- Modify: `src/scanner/Issue.ts`
- Create: `src/fix/action-policy.ts`
- Create: `src/tests/action-policy.test.ts`
- Modify: scanner tests that expose fix actions
- Modify: `src/tests/cli.test.ts`

Add optional, additive fields so existing CLI consumers keep working:

```ts
type FixEligibility = "eligible" | "review-required" | "blocked";

type FixImpact = {
	filesChanged: number;
	filesTrashed: number;
	inboundReferences: number;
	coverageComplete: boolean;
};
```

Required policy:

- [ ] Confirmed findings may be `eligible` when their action evidence is complete.
- [ ] Candidate findings are at least `review-required`.
- [ ] Unverified findings are `blocked`.
- [ ] Incomplete reference coverage blocks trash actions.
- [ ] Additive JSON fields do not remove or rename existing stable fix metadata.

Focused verification:

```bash
npm test -- src/tests/action-policy.test.ts src/tests/cli.test.ts
```

Expected: policy decisions are pure, deterministic, and serialized additively.

### Task 2.2: Present impact before confirmation

**Files:**

- Modify: `src/fix/confirm-modal.ts`
- Modify: `src/report/render-issues.ts`
- Modify: `styles.css`
- Modify: `src/tests/confirm-modal.test.ts`
- Modify: `src/tests/render-issue-actions.test.ts`

The review must show:

- file paths, size, and modification time;
- known inbound references;
- reference-coverage completeness;
- which duplicate path will be retained;
- note modifications and files moved to trash;
- why an action requires review or is blocked.

Required behavior:

- [ ] Bulk selection does not silently include destructive candidate actions.
- [ ] Review-required actions need an explicit per-item decision.
- [ ] Blocked actions render the reason and expose no confirm control.
- [ ] Narrow layouts keep paths and decisions readable.

Focused verification:

```bash
npm test -- src/tests/confirm-modal.test.ts src/tests/render-issue-actions.test.ts src/tests/styles.test.ts
```

Expected: the confirmation model and rendered controls enforce the same policy.

### Task 2.3: Preserve verified batch execution semantics

**Files:**

- Modify: `src/fix/fix-decisions.ts`
- Modify: `src/fix/fix-runner.ts`
- Modify: `src/report/render-outcomes.ts`
- Modify: `src/tests/fix-decisions.test.ts`
- Modify: `src/tests/fix-runner.test.ts`
- Modify: `src/tests/render-outcomes.test.ts`

Required behavior:

- [ ] Freeze a structured clone of detection settings for the whole batch.
- [ ] Run a fresh preflight before every independent action.
- [ ] Skip actions when fingerprint, target paths, keep candidates, or action
  metadata change.
- [ ] Continue independent items after one execution failure.
- [ ] Run one final verification scan and distinguish fixed, still-present,
  skipped, execution-failed, and verification-failed outcomes.
- [ ] Keep operation outcomes visible until the user dismisses them.

Focused verification:

```bash
npm test -- src/tests/fix-decisions.test.ts src/tests/fix-runner.test.ts src/tests/render-outcomes.test.ts
```

Expected: no stale or policy-blocked action executes, and every attempted change
has a visible final status.

### Milestone 2 acceptance

- [ ] Unverified results never execute fixes.
- [ ] Candidate destructive actions require explicit per-item review.
- [ ] Every trash operation uses Obsidian's trash API.
- [ ] Every mutation has preflight and post-action verification.
- [ ] Existing CLI consumers still receive all previous stable fields.

Suggested branch: `feat/action-impact-review`

Suggested commits:

```text
feat: define fix action impact policy
feat: preview fix impact before confirmation
feat: enforce action policy in verified batches
```

## Milestone 3: Emphasize changes and add conservative recurrence

### Task 3.1: Persist bounded scan-summary history

**Files:**

- Create: `src/snapshot/scan-history.ts`
- Create: `src/tests/scan-history.test.ts`
- Modify: `src/settings/plugin-data.ts`
- Modify: `src/snapshot/scan-snapshot.ts`
- Modify: `src/main.ts`
- Modify: `src/tests/plugin-data.test.ts`
- Modify: `src/tests/scan-snapshot.test.ts`

Store the existing complete last-successful snapshot plus at most twenty compact
history entries containing:

- creation time and tool version;
- scan profile and comparison version;
- manual or automatic trigger;
- files scanned and scanners run;
- active, ignored, new, persisting, and resolved totals;
- severity and classification counts.

Required behavior:

- [ ] Do not store multiple complete issue lists.
- [ ] Keep the newest twenty valid entries.
- [ ] Parse legacy flat settings and the current settings-plus-snapshot envelope.
- [ ] Discard invalid history entries without discarding valid settings or the
  last successful snapshot.
- [ ] Failed or incomplete scans do not append history or replace snapshots.

Focused verification:

```bash
npm test -- src/tests/scan-history.test.ts src/tests/plugin-data.test.ts src/tests/scan-snapshot.test.ts
```

Expected: persistence is backward compatible, bounded, and updated only after
accepted successful scans.

### Task 3.2: Make scan changes the primary report summary

**Files:**

- Modify: `src/report/render-summary.ts`
- Modify: `src/report/InspectorView.ts`
- Modify: `src/report/report-model.ts`
- Modify: `styles.css`
- Modify: `src/tests/render-summary.test.ts`
- Modify: `src/tests/inspector-view-filters.test.ts`

Required behavior:

- [ ] Show new confirmed errors and warnings before aggregate totals.
- [ ] Show persisting and resolved counts from the last compatible scan.
- [ ] Show the previous successful scan time and why comparison is unavailable.
- [ ] Add a `Review new findings` control without silently hiding other results.
- [ ] Keep ignored findings active in lifecycle comparison.
- [ ] Keep resolved entries historical and non-actionable.

Focused verification:

```bash
npm test -- src/tests/render-summary.test.ts src/tests/inspector-view-filters.test.ts src/tests/result-diff.test.ts
```

Expected: users can reach new confirmed findings directly while all current and
historical states retain their existing semantics.

### Task 3.3: Decouple scan sessions from the report view

**Files:**

- Create: `src/scanner/scan-session.ts`
- Create: `src/tests/scan-session.test.ts`
- Modify: `src/main.ts`
- Modify: `src/report/InspectorView.ts`
- Modify: `src/tests/main.test.ts`

Responsibilities of `scan-session.ts`:

- clone settings and create the scan profile;
- run one scan through the existing serialized operation boundary;
- publish optional progress events;
- compare and accept successful results;
- persist snapshot and summary history;
- return a result without requiring an open `InspectorView`.

Required behavior:

- [ ] Manual scans still open and update the report view.
- [ ] Headless scans can complete without creating a view.
- [ ] Only one scan or mutation batch runs at a time.
- [ ] A failed progress consumer cannot convert a completed scan into a failed
  detection result.

Focused verification:

```bash
npm test -- src/tests/scan-session.test.ts src/tests/main.test.ts
```

Expected: manual behavior remains unchanged and successful headless scans update
persistence through the same acceptance path.

### Task 3.4: Add an opt-in stale-scan trigger

**Files:**

- Create: `src/scanner/scan-scheduler.ts`
- Create: `src/tests/scan-scheduler.test.ts`
- Modify: `src/settings/settings.ts`
- Modify: `src/settings/settings-tab.ts`
- Modify: `src/scanner/scan-profile.ts`
- Modify: `src/main.ts`
- Modify: `src/tests/settings.test.ts`
- Modify: `src/tests/settings-tab.test.ts`

Settings:

- `automaticScanIntervalHours`: `0` disables automatic scans and remains the
  default.
- `automaticScanNetworkChecks`: `false` by default and controls whether an
  automatic scan may include the external-link scanner.

Required behavior:

- [ ] Schedule one startup check after the workspace settles.
- [ ] Run only when the last successful scan is older than the configured
  interval.
- [ ] Never run more than once in one plugin activation.
- [ ] Skip while another scan or mutation is active.
- [ ] Never execute fixes or export reports.
- [ ] Exclude external links unless network checks are separately enabled.
- [ ] Notify only when a completed automatic scan finds new confirmed errors;
  otherwise update persistence silently.
- [ ] Treat scheduling settings as presentation/orchestration settings, not
  detection-profile inputs; the effective scanner set remains part of the
  profile.

Focused verification:

```bash
npm test -- src/tests/scan-scheduler.test.ts src/tests/settings.test.ts src/tests/settings-tab.test.ts src/tests/main.test.ts
```

Expected: default installations remain manual, automatic scans are bounded and
read-only, and network checks require separate opt-in.

### Milestone 3 acceptance

- [ ] History retains at most twenty summary entries.
- [ ] Profile changes never mark every issue as new or resolved.
- [ ] Ignoring an issue does not resolve it.
- [ ] Automatic scanning remains off by default.
- [ ] Automatic scanning never mutates the vault or silently runs network checks.
- [ ] Manual scanning and report progress remain functional.

Suggested branches:

```text
feat/scan-history
feat/automatic-stale-scan
```

Suggested commits:

```text
feat: persist bounded scan summary history
feat: prioritize changes in scan summaries
refactor: decouple scan sessions from report views
feat: add opt-in stale vault scans
```

## Milestone 4: Align CLI lifecycle comparison

### Task 4.1: Add profile metadata to CLI output

**Files:**

- Modify: `cli/cli.ts`
- Modify: `src/scanner/scan-profile.ts`
- Modify: `src/snapshot/scan-snapshot.ts`
- Modify: `src/tests/cli.test.ts`
- Modify: `src/tests/cli-package.test.ts`

Additive top-level metadata:

```ts
type CliComparison = {
	available: boolean;
	mode: "profile" | "legacy" | "none";
	reason?: "missing-baseline" | "settings-changed" | "semantics-changed";
	newIssues: number;
	persistingIssues: number;
	resolvedIssues: number;
};
```

Required behavior:

- [ ] Emit scan profile and comparison version without removing stable fields.
- [ ] Retain `isNew` for compatibility.
- [ ] Keep schema additions machine-readable and keep messages informational.
- [ ] Keep JSON output on stdout and progress/warnings on stderr.

Focused verification:

```bash
npm test -- src/tests/cli.test.ts src/tests/cli-package.test.ts
node cli.js --help
```

Expected: old fields remain present and new profile metadata is additive.

### Task 4.2: Make baseline comparison compatibility-aware

**Files:**

- Modify: `cli/cli.ts`
- Modify: `src/scanner/result-diff.ts`
- Modify: `src/tests/cli.test.ts`
- Modify: `src/tests/result-diff.test.ts`

Required behavior:

- [ ] Read current baselines with profile and comparison metadata.
- [ ] Read legacy baselines through fingerprint-only comparison and expose
  `mode: "legacy"` plus a stderr warning.
- [ ] Treat current-format profile or semantics mismatches as setup failures with
  exit code `2` instead of marking every issue new.
- [ ] Emit new, persisting, and resolved counts for compatible baselines.
- [ ] Preserve `--fail-on new`, severity thresholds, and existing exit-code
  behavior for comparable scans.

Focused verification:

```bash
npm test -- src/tests/cli.test.ts src/tests/result-diff.test.ts
```

Expected: mismatched baselines cannot create false lifecycle results and legacy
baseline users receive a compatible migration path.

### Task 4.3: Align CLI detection configuration

**Files:**

- Modify: `cli/cli.ts`
- Modify: `src/settings/settings.ts`
- Modify: `src/scanner/scan-profile.ts`
- Modify: `src/tests/cli.test.ts`
- Modify: `README.md`
- Modify: `skills/vault-inspector/SKILL.md`

Required behavior:

- [ ] Accept per-scanner ignored folders in the JSON config.
- [ ] Include effective per-scanner folders in the CLI scan profile.
- [ ] Document profile-aware baselines and legacy behavior.
- [ ] Keep Agent Skill guidance read-only and teach it to interpret unavailable,
  legacy, new, persisting, and resolved comparison states.
- [ ] Continue rejecting `--fix` as unsupported.

Focused verification:

```bash
npm test -- src/tests/cli.test.ts
npm run build
npm pack --dry-run
```

Expected: the npm CLI package and the repository Agent Skill expose the same
documented lifecycle semantics without gaining mutation capability.

### Milestone 4 acceptance

- [ ] Legacy baselines remain readable.
- [ ] Current incompatible baselines never produce false new/resolved counts.
- [ ] Stable CLI fields and exit behavior remain compatible for comparable scans.
- [ ] Per-scanner exclusions affect plugin and CLI profiles consistently.
- [ ] CLI scans remain read-only.

Suggested branch: `feat/cli-lifecycle-parity`

Suggested commits:

```text
feat: expose CLI scan profile metadata
feat: compare compatible CLI scan baselines
feat: align CLI scanner exclusion profiles
docs: explain CLI lifecycle comparison
```

## Pull request and release sequence

Create focused PRs in this order:

1. `feat/scanner-precision-foundation`
2. `feat/reference-index`
3. `fix/orphan-and-duplicate-precision`
4. `fix/link-and-empty-note-precision`
5. `fix/external-link-classification`
6. `feat/action-impact-review`
7. `feat/scan-history`
8. `feat/automatic-stale-scan`
9. `feat/cli-lifecycle-parity`
10. A separate release PR after all intended implementation PRs are merged.

Every PR description must include:

- the product behavior changed;
- explicit non-goals;
- focused tests run;
- full verification results;
- migration or compatibility impact;
- manual validation performed;
- remaining detection boundaries.

## Verification matrix

### Focused test cycle

For every behavioral task:

1. Write the focused failing test.
2. Run the exact test and confirm the expected failure.
3. Implement the smallest behavior change.
4. Run the focused test and confirm it passes.
5. Run adjacent scanner, report, fix, snapshot, or CLI tests.
6. Commit only the logical scanner or subsystem change.

### Full automated verification

Run before every commit as required by the repository rules:

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
```

Run before every PR and any change affecting CLI packaging or release assets:

```bash
npm pack --dry-run
node cli.js --help
```

Expected:

- all commands exit `0`;
- Vitest reports zero failed tests;
- ESLint reports zero warnings or errors;
- build regenerates usable `main.js` and `cli.js`;
- the package contains only the documented npm assets.

### Manual verification

- Run read-only scans against `/Users/Roger/my-vault` to validate realistic
  performance and result presentation.
- Perform all trash and note-modification scenarios only in a disposable copy or
  temporary fixture vault.
- Verify narrow and wide Obsidian layouts for evidence, impact, confirmation,
  lifecycle summary, ignored items, and resolved items.
- Verify automatic scans with the report view closed and open.
- Verify external-link fallback against controlled test servers; do not depend on
  public websites for release acceptance.

### Security verification

External-link work must prove:

- direct loopback and private IP destinations are blocked;
- DNS resolution to any non-public address is blocked;
- redirects are reassessed before connecting;
- HEAD-to-GET fallback uses the same destination checks;
- request bodies are absent and response bodies are not retained;
- timeout, redirect, and scan budgets remain bounded.

## Definition of done

The roadmap is complete only when all of the following are true:

- [ ] Supported Markdown, frontmatter, and Canvas references do not produce known
  orphan-attachment false positives.
- [ ] Structural notes are not misreported as empty solely because they contain
  little prose.
- [ ] External-link results distinguish dead, restricted, rate-limited,
  temporary, blocked, and unverified outcomes.
- [ ] Duplicate confirmation requires matching content hashes.
- [ ] Users can see action impact before any mutation.
- [ ] Candidate and unverified findings cannot be bulk-mutated silently.
- [ ] Every mutation is preflighted and verified by a final scan.
- [ ] Repeat scans foreground new, persisting, and resolved findings.
- [ ] Automatic scans are off by default, bounded, read-only, and network-off by
  default.
- [ ] CLI lifecycle output validates comparison compatibility and retains stable
  automation fields.
- [ ] No new scanner category, telemetry, cloud service, CLI mutation, or UI
  localization framework has entered scope.
- [ ] Full lint, warning lint, build, test, package, and manual acceptance gates
  pass for each released milestone.

## First execution handoff

Begin with Milestone 0 only. Write and approve:

```text
docs/superpowers/specs/2026-08-29-scanner-precision-foundation-design.md
docs/superpowers/plans/2026-08-29-scanner-precision-foundation.md
```

Do not implement Milestone 1 until the precision fixture and performance baseline
are merged. The measured baseline determines which scanner refinements are safe
to combine and whether the shared reference index needs further decomposition.
