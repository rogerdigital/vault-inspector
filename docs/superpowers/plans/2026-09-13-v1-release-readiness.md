# Vault Inspector 1.0.0 Release Readiness Implementation Plan

**Goal:** Resolve the reproduced safety and correctness issues within the existing eight-scanner plugin/CLI scope, and establish release readiness through verifiable artifacts and native runtime evidence.

**Architecture:** Preserve the scanners, reference index, centralized action policy, serialized operation queue, confirmation/preflight/final verification, snapshots, and CLI schema. Atomic writes belong in the executor, native cache synchronization at the plugin adapter boundary, and configuration validation at the CLI input boundary. Keep runtime differences out of scanner logic.

**Tech Stack:** TypeScript, Obsidian API, Vitest, esbuild, Node.js, GitHub Actions, Markdown.

**Status:** Planned. Only plan authoring and static checks are complete; none of the implementation, acceptance, commit, PR, or release tasks below have been executed through this plan.

## 1. Start here

This file is the sole execution entry point. Its three companion documents are executable parts of this plan, not roadmaps that require another planning cycle:

1. [A — Core safety and correctness](2026-09-13-v1-core-reliability.md): A1 atomic writes, A2 missing target cache, A3 native cache synchronization.
2. [B — CLI and release gates](2026-09-13-v1-cli-release-gates.md): B1 configuration validation, B2 installed artifact checks, B3 runtime matrix, B4 release version gates, B5 documentation/release workflow.
3. [C — Native runtime and final acceptance](2026-09-13-v1-runtime-acceptance.md): C1–C6 desktop, upgrades, mobile, large vaults, evidence review, and release execution.

At execution time, read the repository's `AGENTS.md`, `CLAUDE.md`, and `tasks/lessons.md`. Relative paths are rooted at `/Users/Roger/Code/personal/vault-inspector`; when executing in a worktree, use that worktree's actual root. Locate code by symbol; line numbers can change between commits.

### Ready-to-use handoff instructions

> Read and execute `docs/superpowers/plans/2026-09-13-v1-release-readiness.md` and its three linked companion documents. Start with S0 baseline verification, then complete A1, A2, A3, B1–B5, and C1–C5 in dependency order. Reproduce each issue before changing code, run focused tests and the complete project gates, and update the progress table and acceptance evidence. Resolve routine implementation choices independently within the agreed scope without repeatedly requesting confirmation. If external devices or permissions are unavailable, record the exact blocker and complete independent work; never substitute mocked tests for native acceptance. This handoff does not authorize merging PRs, pushing release tags, or publishing to npm. Execute C6 when explicit release authorization already exists in the session; otherwise complete all release preparation and report readiness.

## 2. Baseline and confirmed facts

- Authoring baseline: `main`, `fdcc77d`, product version `0.8.1`. Recheck HEAD before execution; do not assume the working tree is unchanged.
- On 2026-09-13, lint, warning lint, build, coverage, and package dry run passed: 60 test files, 914 tests, and 84.36% line coverage for plugin `src/**`. These are not results for future commits; coverage currently excludes root-level `cli/**`.
- The initial test run failed only because the sandbox prohibited listening on `127.0.0.1`; all tests passed when listening was permitted. Treat equivalent failures as environment restrictions. Do not delete SSRF tests or weaken assertions.
- The eight scanners, reference index, candidate/unverified classifications, action impact, preflight/final verification, history, conservative automatic scanning, and CLI baselines are already implemented. Empty checkboxes in the old umbrella roadmap do not prove missing implementation.
- A1 was reproduced against actual source with deterministic concurrent-write injection. No actual user data-loss incident is claimed.
- A2 was reproduced with a populated source-note cache and a `null` target cache: it incorrectly returned `confirmed` with an executable link fix.
- A3's native observation is recorded under “Remaining runtime observations and acceptance boundaries” in `docs/superpowers/plans/2026-09-08-audit-bugfix-plan.md`: the write was correct, but immediate verification showed Still present.
- B1 was reproduced with the current CLI: a string threshold silently produced zero findings, and an array was accepted as the configuration root.
- A three-run CLI benchmark with 10,000 notes, 12,002 files, and 3,647 findings measured median loading at 5,235ms and median scanning at 1,400ms. This is not UI or batch-operation acceptance.

## 3. Scope and invariants

- Do not add scanners, cloud services, telemetry, real-time daemons, full history browsing, localization frameworks, CLI mutations, or automatic duplicate-reference rewrites.
- Preserve fix confirmation, per-item preflight, reference-coverage blocking, and final verification. Never bypass safety to improve performance.
- Scanning and the CLI remain read-only. Destructive acceptance uses only isolated files or disposable vaults created for this run.
- Keep public `Issue` and `FixAction` field types and CLI `schemaVersion = 1` unchanged; snapshot schema remains 1.
- A2 changes detection semantics: raise `COMPARISON_VERSION` from baseline 3 to 4. If a higher semantics version has already shipped when execution starts, increment the actual shipped version instead. Increment once within the same unreleased fix series; never reuse a published semantics number.
- Do not change normal finding fingerprints merely because the product reaches 1.0.0. Express unavailable cache evidence through classification/evidence, and isolate older baselines with the comparison version.
- Preserve the declared minimums of Node `>=18`, Obsidian `1.7.2`, and `isDesktopOnly:false` pending acceptance evidence. Do not independently narrow support promises to make checks pass.
- Do not split into a monorepo to improve warning scores, and never disable `obsidianmd/*` rules.

## 4. S0 — Baseline verification and recovery point

- [ ] Run these read-only checks and record HEAD, branch, runtime versions, and working-tree state:

```bash
pwd
git status --short --branch
git rev-parse HEAD
git log -5 --oneline
node --version
npm --version
```

- [ ] Preserve any uncommitted user changes and execute in a clean worktree. Do not stash, reset, or overwrite user files. Simple documentation edits do not require a worktree; use `fix/v1-core-reliability` for product implementation.
- [ ] Run the gates below against the current baseline. Distinguish existing code failures from environment restrictions. Store output in a temporary directory outside the repository and record commands, exit codes, and failure summaries; do not copy sensitive paths or credentials into the report.

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm run test:coverage && npm pack --dry-run
node cli.js --help
```

- [ ] Create `docs/validation/1.0.0-readiness.md` using the structure in companion C. Update this file's progress table when S0 is complete.
- [ ] Compare current source with the functions and signatures in this plan. If another commit already fixed an issue, prove it with the corresponding regression case, then mark it “already satisfied — commit + command”; do not implement the fix again.

## 5. Dependencies and work allocation

```text
S0 -> A1 -> A2 -> A3 -> Integration gates -> C1/C2/C3/C4 -> C5 -> C6
  \-> B1 -> B2 -> B3 -> B4 -> B5 -----------/
```

- A1/A2 can be investigated independently, but commit them serially. A3 depends on A1's atomic write boundary and A2's conservative classification.
- B1 is independent of companion A and may use a separate branch. B2/B3/B4 share package/workflow files and must be edited serially by one implementer.
- Give each scanner its own commit; do not mix scanner changes with UI, CLI, or release configuration.
- During integration, check `git status --short` and `git show --stat HEAD`. Passing tests on a tree containing uncommitted changes do not prove that the commit itself passes.
- Unavailable devices do not block independent code, CI, or documentation work, but C5 must not declare release readiness while required device acceptance is blocked.

## 6. Progress table

Record actual commits, commands, and evidence links as each item completes. There is no need to rewrite every checkbox in historical plans.

| ID | Work | Status | Completion criterion/evidence |
|---|---|---|---|
| S0 | Baseline, isolation, and acceptance record | Planned | Reproducible baseline commands and HEAD |
| A1 | Atomic link fixes | Planned | Concurrency regression and source-preservation cases |
| A2 | Conservative handling of missing target metadata | Planned | Null/empty/populated cache matrix and old baseline invalidation |
| A3 | Native cache synchronization after writes | Planned | Event-order tests and native C1 acceptance |
| B1 | CLI configuration structure/field validation | Planned | Invalid input exits 2; valid zero values/empty lists remain supported |
| B2 | CLI smoke after tarball installation | Planned | Both commands, JSON, exit codes, baseline, and read-only checks |
| B3 | Supported runtime matrix | Planned | The same artifact passes on Node 18 and 24 |
| B4 | Release tag/version/commit gates | Planned | Wrong tags rejected; unverified commits not published |
| B5 | Documentation and protocol commitments | Planned | User documentation matches current behavior |
| C1 | Native desktop safety workflow | Planned | File-level assertions, UI outcomes, and environment restoration |
| C2 | Upgrade/minimum version | Planned | Upgrade from 0.8.1 and Obsidian 1.7.2 acceptance |
| C3 | Mobile | Planned | iOS/Android core workflow evidence |
| C4 | Large-vault interaction and batch operations | Planned | Recorded scale, timing, interaction, and resource evidence |
| C5 | Release candidate review | Planned | Evidence for all hard gates; no safety/correctness blockers |
| C6 | Formal release and channel verification | Not authorized by this plan | Run the release procedure after explicit release authorization |

Allowed states: Planned, In progress, Passed, Failed, Blocked, Already satisfied. Blocked entries must name the cause, exact missing device/permission, and resumption command; do not label them Passed with caveats.

## 7. Required gates for each implementation commit

After focused RED/GREEN checks, run before committing:

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
git diff --check
```

For CLI/package/release changes, also run B2's artifact smoke and `npm pack --dry-run`. Run coverage again at C5. Do not write tests that mirror the implementation just to raise coverage; new regressions must fail against the original defective code.

Stage only files listed for the task, and use English Conventional Commits. Never commit directly to protected main. PR titles and descriptions should cover engineering behavior, compatibility, and verification only, without tool attribution.

Suggested PR boundaries: `fix/v1-core-reliability` (A1–A3), `fix/v1-cli-config-validation` (B1), `ci/v1-release-gates` (B2–B4), `docs/v1-release-readiness` (B5/C evidence), then a separate release PR. If the session already authorizes PR creation, proceed with push and PR creation; otherwise complete local implementation and verification, then report.

## 8. Completion conditions and delivery format

Implementation completion is not release readiness. Mark “Ready for release” only after C5 passes, and “Released” only after C6 verifies each distribution channel.

The final execution report must include actual HEAD, completed/incomplete IDs, test and package results, native devices/versions, reproduction and fix evidence for the four defects, external blockers, working-tree state, and whether publication occurred. Test counts alone are not proof of safety.

## 9. Validation of this plan

On 2026-09-13, the following checks validated the plan only; they do not complete A/B/C implementation tasks:

- Relative links, code fences, task identifiers, and dependency consistency were checked across all four documents.
- The A3 event-synchronization module and tests were extracted into a temporary directory outside the repository. All 9 tests passed, and the module passed TypeScript checks against the local Obsidian API. A browser timer versus Node Timeout type conflict was corrected during validation.
- The B1 configuration validator was extracted and combined with current CLI source in a temporary build. Seven classes of invalid input returned exit2 before scanning, with empty stdout.
- These are not integration results and do not establish native metadata ordering, Node 18 artifact compatibility, mobile acceptance, or release-gate success. Execution still requires RED/GREEN checks, integration gates, and actual device acceptance.
- This authoring run added only four plans. Product source, versions, CI, and user vaults were unchanged; nothing was committed, pushed, or published.
