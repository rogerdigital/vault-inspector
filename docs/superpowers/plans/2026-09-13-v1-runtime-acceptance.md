# 1.0.0 Runtime Acceptance and Release Implementation Plan

**Goal:** Demonstrate that core workflows meet release criteria using installed artifacts, native devices, and file-level assertions.

**Architecture:** Isolate acceptance fixtures from user files. Automated tests establish deterministic boundaries; native acceptance verifies Obsidian events and interaction behavior. Bind all evidence to an exact commit and artifact checksums.

**Tech Stack:** Obsidian desktop/iOS/Android, Node.js, the existing CLI benchmark, and Markdown acceptance records.

Read the [overall plan](2026-09-13-v1-release-readiness.md) first. Complete formal acceptance of the candidate artifacts only after all A/B work is integrated; devices and fixtures may be prepared earlier.

## C0 — Evidence format, fixtures, and environment restoration

**Create:** `docs/validation/1.0.0-readiness.md`. Use the complete structure below and record actual results in the tables. Mark unexecuted checks as `Not run`; do not invent dates, devices, durations, or screenshots.

```markdown
# 1.0.0 Readiness Evidence

Status: Not ready

## Candidate
- Commit: Not run
- Asset SHA-256: Not run
- Date and timezone: Not run
- Build Node/npm: Not run
- Obsidian/device/OS: Not run

## Automated gates
| Check | Command | Exit code | Result | Evidence |
|---|---|---|---|---|
| Core regression | Not run | Not run | Not run | Not run |
| Full verification | Not run | Not run | Not run | Not run |
| Installed package | Not run | Not run | Not run | Not run |

## Native acceptance
| ID | Environment | Steps | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|---|
| C1.1 | Not run | Initial scan | Correct fixture findings | Not run | Not run | Not run |

## Performance
| Candidate | Device | Files/findings | Scenario | Three samples | Median | Result |
|---|---|---|---|---|---|---|
| Not run | Not run | Not run | Not run | Not run | Not run | Not run |

## Known boundaries
Record supported reference channels, unavailable devices, and any failed gate.

## Environment restoration
Record test-owned files removed and original settings/assets restored.

## Release decision
Not ready until all required gates have evidence.
```

- [ ] Store all screenshots/logs in a temporary directory for this run outside the repository. The committed report must reference only sanitized summaries and durable attachment locations. Temporary paths must not be the only evidence: include key commands, expected/actual results, and checksums in the report.
- [ ] `/Users/Roger/my-vault` may be read for realistic-scale read-only scans. Prefer a separate disposable vault for write/delete acceptance; do not scan or copy unrelated personal directories.
- [ ] If the standard test vault must be used, operate only within a separate fixture subdirectory created for this run. First back up the plugin’s `data.json`, its three assets, and any UI preferences that will change. Restore each item from the backup inventory during cleanup; never delete the entire vault or `.obsidian`.
- [ ] Run the temporary-directory generator, creating fixtures only under the system temporary directory. Save it as `create-fixture.mjs` in this run’s temporary directory, then execute `node <absolute-script-path>`:

```js
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "vi-v1-acceptance-"));
for (const dir of ["notes", "assets", "duplicates/a", "duplicates/b"]) {
  await mkdir(join(root, dir), { recursive: true });
}
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>';
const files = {
  "notes/Target.md": "# Existing\n\nBlock content ^block-id\n",
  "notes/Source.md": [
    "# Source", "[[Target#Existing]]", "[[Target#^block-id]]",
    "[[#Source]]", "[[Target#Missing heading]]",
    "[Readable label](missing-note)",
    "    [Readable label](missing-note)",
    "\\[Readable label](missing-note)",
    "`[Readable label](missing-note)`",
    "```md", "[Readable label](missing-note)", "```",
    "<!-- [Readable label](missing-note) -->",
    "![[assets/referenced.svg]]", "[[duplicates/a/copy.svg]]",
    "[[duplicates/b/copy.svg]]",
  ].join("\n\n"),
  "notes/结构笔记.md": "# Index\n\n[[Target]]\n- [ ] Review\n",
  "notes/Empty.md": "# Empty\n",
  "assets/referenced.svg": svg,
  "assets/canvas-only.svg": svg,
  "assets/orphan.svg": svg,
  "duplicates/a/copy.svg": svg,
  "duplicates/b/copy.svg": svg,
  "board.canvas": JSON.stringify({ nodes: [
    { id: "f", type: "file", file: "assets/canvas-only.svg", x: 0, y: 0, width: 200, height: 100 },
  ], edges: [] }),
};
for (const [name, content] of Object.entries(files)) {
  await writeFile(join(root, name), content);
}
console.log(root);
```

- [ ] Record the actual path printed by the generator as this run’s disposable vault; do not treat example placeholder paths as deletion targets. Open it in Obsidian using “Open folder as vault” and close other applications that may write to that directory. Install the candidate `main.js`/`manifest.json`/`styles.css`, enable only the target plugin, and initially leave automatic and network scans disabled.
- [ ] Save the initial SHA-256 inventory of fixture files. Regenerate a separate fixture or restore the affected test files for every mutation scenario so earlier scenarios do not alter later expectations.

## C1 — Native behavior on the current desktop version

**Deliverable:** Rows C1.1–C1.10 in the report above. Screenshots demonstrate interaction results; disk assertions prove actual writes. Test the currently installed stable Obsidian release and record its actual version rather than inferring it from documentation.

| ID | Steps | Required result |
|---|---|---|
| C1.1 | Install, enable, run Run scan, and wait for normal indexing to finish | No false positives for valid heading/block/same-note references; Missing heading produces a finding; the structural note is not empty; the Canvas-referenced SVG is not orphaned |
| C1.2 | Open confirmation for the actual `[Readable label](missing-note)` link and execute | Only the actual link becomes `Readable label`; indented, escaped, inline/fenced code, and HTML comment content remain byte-for-byte unchanged; this run reports Fixed rather than an incorrect Still present |
| C1.3 | Have another editor save an additional paragraph before executing the fix; repeat 3 times | The new paragraph is fully preserved; do not claim this manual procedure reproduces the exact race, which is established by the deterministic A1 regression |
| C1.4 | After opening confirmation, add the missing heading to the target, wait for the cache update, then confirm the old action | Preflight skips the action; Source content is not rewritten |
| C1.5 | Change board.canvas to invalid JSON and scan again | Incomplete coverage is shown; trash actions that depend on reference coverage cannot be executed; restoring valid JSON restores availability |
| C1.6 | Open confirmation for two duplicates that both have references | An explicit keep selection is required; cancellation changes nothing; execution trashes only the other selected item; actually restore it from the trash configured by the system/Obsidian and verify the content hash matches |
| C1.7 | Select a mixed batch of confirmed/review-required/unverified findings | The batch does not silently include review-required/blocked items; exclusion counts match the selection; a failed item cannot cause later entries to be falsely reported as Fixed |
| C1.8 | Export a normal report; then generate a full report >1MiB from many findings and exercise cancel, summary, and full export in sequence | Cancellation creates no file; the summary retains totals without individual details; the full export includes every expected path without splitting paths containing commas or Chinese characters; inspect actual disk output |
| C1.9 | ignore→rescan→restore; repeatedly click the new-findings CTA, then clear filters; inspect resolved entries | Ignored findings do not count as resolved; CTA results and counts agree; historical rows are read-only; restored findings can be reviewed again |
| C1.10 | Confirm automatic scans are disabled by default; enable a short test interval with the report view closed and open; restore defaults | Automatic scans are read-only; network access is not enabled without authorization; no overlapping writes occur; unload/reload leaves no dangling listeners or duplicate callbacks |

- [ ] Use only controlled adapters/test servers for external-link acceptance covering 401/403/429/404/410/5xx, HEAD 405/501 fallback, and private-address/DNS/redirect blocking. Do not disable destination safety checks to allow local test requests. Availability of real public URLs is not an acceptance gate.
- [ ] Cover A3 timeout/unload, wrong-file events, stale-content events, and events arriving before the write promise resolves through persistent test injection. Verify that at least 3 actual writes synchronize successfully through the native path. If native behavior does not emit the expected events, mark C1 Failed, correct the adapter using actual event logs, and rerun; do not add a fixed sleep and claim completion.
- [ ] Check confirmation paths, buttons, error explanations, and result badges in dark/light themes and wide windows/approximately 360px sidebars. Keyboard Tab/Enter/Escape must support confirmation or dismissal; no new interface system is required.

### Large-report fixture

- [ ] Add `notes/many-missing.md` to the disposable vault using the following expression to generate its content, then scan and test export:

```js
const content = Array.from({ length: 12000 }, (_, i) => `[[absent-${i}|Missing ${i}]]`).join("\n");
```

- [ ] Measure the actual Markdown output bytes. If the output does not exceed 1MiB, double the count one step at a time until it crosses the threshold. Use this file only for export testing, not the normal performance benchmark.

## C2 — Upgrade from the previous version and minimum-version support

- [ ] Obtain actual 0.8.1 artifacts from Git history or the official release. In a separate fixture vault, complete a scan, ignore one finding, and change one scanner exclusion; close the application and back up plugin data. Handwritten “old-version data” must not be the sole upgrade evidence.
- [ ] Replace the three plugin assets with the candidate without deleting `data.json`, then restart. Settings/ignored findings must be preserved, the snapshot must report semantics-changed, no false all-new/all-resolved comparison may appear, and subsequent scans with the same settings must compare normally.
- [ ] Create a CLI baseline from actual previous-version output. The candidate must exit 2 for input with profile comparisonVersion=3 and explain on stderr that the baseline must be regenerated. Remove `--baseline` to generate a new baseline, then verify the next run works normally. The CLI schema remains 1.
- [ ] Install Obsidian 1.7.2 separately, run C1.1, C1.2, C1.4, C1.6, C1.8, and C1.9, and verify A3 event synchronization. Record the installation source and version; do not overwrite the user’s regular installation/data.
- [ ] Mark the check Blocked if the previous version cannot be obtained, installation is restricted, or a device is unavailable; continue other tasks. Do not raise minAppVersion without authorization to eliminate a failure.
- [ ] Install the same candidate tarball in a separate Windows temporary directory. Invoke `node_modules\.bin\vault-inspector.cmd` and `vinspect.cmd` separately through PowerShell against the small C0 fixture with `--format json --fail-on none`. Verify `$LASTEXITCODE` is 0 and JSON toolVersion matches the package version; repeat the B2 baseline/exit1/exit2 scenarios. Record the actual Node version and a vault path containing spaces and Chinese characters. Ubuntu shell-bin tests do not replace this check; record Windows CLI Blocked separately if a device is unavailable.

## C3 — Mobile

- [ ] Install the candidate on at least one available iOS device and one Android device, or equivalent native test environments, and record OS and Obsidian versions. A narrow desktop window does not count as mobile acceptance.
- [ ] Using disposable fixtures, exercise scanning, path navigation, filtering, ignore/restore, fix cancellation, one explicitly confirmed link fix, duplicate-file keep decisions, and Markdown export.
- [ ] Check touch scrolling, the on-screen keyboard, confirmation buttons, and long paths. There must be no `node:*` runtime errors, and the plugin must enable/disable normally.
- [ ] If either C3 environment is unavailable, retain Blocked and list the missing devices; do not change the manifest to desktop-only or fabricate passing records. The publisher may explicitly narrow the supported scope and redefine the version commitment, but that is outside the default execution authorization.

## C4 — Large-vault and batch performance

**Files:** Reuse `scripts/benchmark-scan.mjs` and `src/tests/helpers/synthetic-vault.ts`. Start with measurement only; do not change the architecture.

- [ ] Run the following commands on the same machine without concurrent coverage/build jobs. Save the JSON output, Node/OS versions, machine memory, and commit SHA. `npm --silent` prevents npm banners from contaminating JSON.

```bash
npm --silent run benchmark:scan -- --notes 400 --attachments 150 --runs 3 --json
npm --silent run benchmark:scan -- --notes 10000 --attachments 2000 --runs 3 --json
```

- [ ] Run the 0.8.1 baseline and candidate serially in separate checkouts on the same machine. Compare total loading plus scanning, not only scanMs. Do not run benchmarks concurrently to save time.
- [ ] Install the candidate plugin in the temporary vault printed by benchmark `--keep`. Let native indexing finish, then measure Run scan, time until the first report is interactive, filter changes, Select findings, selecting one item, scrolling, and export.
- [ ] Execute 20 explicitly confirmable local fixes in a copy, recording start/end times, each item’s status, and peak memory. Disable network scans and retain preflight checks. Twenty items is not a hard batch limit.

The budgets below are engineering acceptance criteria for this run, not advertised guarantees for all user hardware:

| Scenario | Candidate acceptance budget |
|---|---|
| Median total CLI loading + scanning on the same machine | No more than 20% regression relative to 0.8.1; explain finding-count changes caused by semantics |
| First screen rendered and interactive for 10k notes / approximately 3k findings | Within 2 seconds after scanning finishes |
| Filtering/selecting one item | Correct feedback within 1 second |
| Local batch of 20 items | Completes within 60 seconds or provides continuous progress feedback; no silent interval indistinguishable from a hang |
| Memory | Peak usage at the same scale increases by no more than 25% relative to the baseline, with no sustained growth/crashes |

- [ ] If a budget is missed, save at least 3 samples and the specific blocking call path, and mark Failed. Determine whether the cause is rendering, repeated scans, parsing, or device resources; do not close the issue merely by relaxing the budget.
- [ ] Clear algorithmic regressions or redundant computation may be corrected within the existing task scope, retaining the corresponding inputs/correctness regressions. If pagination, cancellation controls, or a changed batch-scanning strategy are actually required, submit a separate scoped design and executable plan before implementation; do not add new interactions to this plan based on speculation before measurement. C4 remains Failed until the correction passes acceptance; the release gate cannot be skipped.

## C5 — Release-candidate review

- [ ] Verify that every A/B/C evidence item corresponds to the current candidate commit. Later commits changing native paths invalidate the corresponding C1/C2/C3 acceptance; rerun affected scenarios without indiscriminately repeating every check.
- [ ] Rerun on the current candidate:

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm run test:coverage && npm pack --dry-run
git diff --check
git status --short
```

- [ ] Execute the B2 actual-tarball installation tests. Record SHA-256 checksums for `main.js`, `cli.js`, `manifest.json`, and `styles.css`, and verify they match the files installed on devices during this run.
- [ ] All four defects have reproducible RED and passing GREEN evidence; there are zero safety/correctness failures; no required C1–C4 environment is Blocked; documentation does not claim guaranteed safety for unsupported reference sources.
- [ ] Set the overall table and report to Ready for release only when every criterion above is satisfied. Otherwise retain Not ready and list exact IDs, evidence, and next steps.

## C6 — Formal release (explicit session authorization required)

Complete A/B/C5 before executing this section. Missing authorization blocks only this section, not the preceding local preparation. Use a separate release PR to keep functional fixes separate from the version bump.

- [ ] Create `chore/release-1.0.0` from the latest verified main. First check whether the tag/npm version already exists: `git ls-remote --tags origin refs/tags/1.0.0` and `npm view vault-inspector@1.0.0 version`. Network failure does not mean the version is absent. Published versions must not be overwritten or reused.
- [ ] Run `npm version 1.0.0 --no-git-tag-version` so the existing version lifecycle synchronizes manifest, versions, and CLI version. Verify that package-lock root and packages[""] versions also match. Do not create a tag manually at this stage.
- [ ] Update maintained documentation with the version number and 1.0 behavior/migration notes, recording semantics=4 (or its actual value if legitimately incremented). Run the C5 gates and B2/B3 artifact tests, then commit the version-synchronization file set as `chore: release 1.0.0`.
- [ ] When PR authorization already exists, push and create the release PR, then wait for verify. Do not bypass protection or push directly to main. Merging requires explicit session authorization or must be performed by the user; “release preparation” does not imply merge authorization.
- [ ] After merging, verify that remote main contains the release commit and successful verify result; build 1.0.0 artifacts from a clean checkout of main. At this point, create the lightweight tag with `git tag 1.0.0`, then run `git push origin 1.0.0` so CI creates the release.
- [ ] Do not run `gh release create` manually. Wait for the Release workflow result, verify that all three release assets exist and are downloadable and that manifest.version=1.0.0, and retain checksum/size records. If the workflow fails, inspect the exact logs first; do not delete and repush the tag as a speculative retry.
- [ ] npm is a separate channel. Rerun package gates and generate a tarball from the same release commit; run `npm publish <absolute-path-to-the-tarball-produced-in-this-run> --access public`. Before execution, confirm session authorization, registry, and account ownership; never print tokens. Missing authentication makes only the npm channel Blocked; do not claim both channels are published.
- [ ] Install `vault-inspector@1.0.0` from the registry and use the same B2 fixtures to verify JSON toolVersion, both bins, and exit codes. Verify that GitHub assets and shared npm assets come from the same candidate; local files cannot substitute for download/registry verification.
- [ ] Update the acceptance report to Released and list GitHub and npm results separately. If either channel fails, use Partial release, preserve the successful channel, and address the failure without overwriting a published version.
- [ ] Clean up this run’s test environment and restore original settings. Clean up branches only after the merge is confirmed, and verify remote branch presence/absence with `git ls-remote --heads`.

## Honest completion boundaries

A detailed plan can fully hand off code, commands, and checkpoints, but cannot supply disconnected mobile devices, historical installers, or publishing credentials. When these prerequisites are missing, complete all independent work and leave resumable Blocked entries. No automated implementation can replace evidence from real environments.
