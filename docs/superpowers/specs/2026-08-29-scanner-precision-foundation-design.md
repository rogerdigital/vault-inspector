# Scanner Precision Foundation Design (Milestone 0)

Date: 2026-08-29
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 0)

## Problem

The roadmap's Milestone 1 refactors scanner detection semantics (shared reference
index, structure-aware empty notes, labeled broken-link fixes, external-link
status classification). None of that work is safe to start while current scanner
behavior is only described by scattered unit tests that hand-build
`ScanContext` metadata. We need two things before touching detection logic:

1. A measurable, reproducible statement of what the scanners report today on
   realistic vault content — including the known false positives Milestone 1 is
   chartered to fix — so that later changes flip exactly the intended findings
   and nothing else.
2. A reproducible, non-network performance baseline so the shared
   reference-index work in Milestone 1 can be held to the roadmap's 15%
   scan-duration budget with measured evidence.

## Goals

- One committed fixture vault that exercises every reference form the product
  claims to support (Wiki Links, Markdown links, embeds, aliases, heading
  links, relative paths, Unicode paths, frontmatter links) plus true-negative
  and true-positive cases for orphan attachments, duplicates, empty notes, and
  external links.
- A precision test suite that runs the fixture vault through the same pipeline
  as a CLI scan (`createLocalApp` + `ScanRunner` + default scanners) and asserts
  an exact, sorted inventory of findings, per-finding severity and
  classification, fix-action availability, and fingerprint stability across
  repeat scans.
- A deterministic synthetic-vault generator and a standalone benchmark script
  (`npm run benchmark:scan`) that reports file counts, issue counts, scan
  duration, and files read for hashing, with no network access and no writes
  inside user vaults.
- A generous CI performance regression assertion plus a documented local
  before/after 15% review gate.

## Non-goals

- No production code changes. Scanner, report, fix, settings, and CLI behavior
  must be byte-identical after this milestone.
- No Canvas reference support. A Canvas-referenced attachment is reported as an
  orphan today; this milestone records that behavior as a pinned expected
  finding (the known false positive), it does not fix it.
- No new scanner settings, no fingerprint format changes, no coverage-threshold
  changes, no version bump.
- No test-runner infrastructure beyond vitest; no new dependencies.

## Current behavior being captured (v0.6.0)

Derived from reading the scanners and `cli/local-vault.ts`; each row becomes a
pinned assertion:

| Scanner | Behavior captured |
| --- | --- |
| broken-links | Unresolved note/attachment links are `confirmed`/`error` with a `remove-link-text` fix only when the original syntax was a Wiki Link; broken Markdown links get no fix action; unresolved heading links are `confirmed`/`warning`; an aliased missing Wiki Link merges into the same candidate as its unaliased twin (one finding per link text) |
| orphan-attachments | References resolved from `links`/`embeds`/`frontmatterLinks` via `getFirstLinkpathDest` fallback to basename matching; Canvas references are invisible; findings are `candidate`; severity `info` when mtime is within 7 days, else `warning` |
| empty-notes | Word count only (CJK-aware), title/frontmatter stripped; link-only, embed-only, and task-only notes with few tokens are false positives; every finding is `candidate`/`warning` with a `trash-file` fix |
| duplicate-files | Name + size prefilters, SHA-256 under `duplicateHashMaxBytes`; hash-identical groups are `confirmed`/`warning` with a keep-one fix keeping the lexicographically first path; above the cap they degrade to name/size `info` candidates |
| external-links | Every HTTP status ≥ 400 (including 401/403/429/5xx) is presented as one identical "Dead external link" `candidate`/`warning`; request failures and safety-policy blocks are `unverified`/`info`; scanner disabled by default |
| large-files, frontmatter-types, tag-usage | Fixture vault is built to produce zero findings from these scanners (sizes below thresholds, no shared-typed properties, no tags) so the inventory stays focused on the precision scanners |

## Design

### Fixture vault

Location: `src/tests/fixtures/precision-vault/` — committed real files (no
README inside the vault; a README would itself be scanned and pollute the
inventory). The vault contains 31 files:

- `notes/target.md`, `notes/hub/sibling-note.md`, `notes/unicode/目标笔记.md` —
  valid link destinations.
- `notes/hub/valid-links.md` — Wiki Link, aliased link, heading link, parent-
  relative and sibling-relative Markdown links, attachment embed. Expected:
  zero findings.
- `notes/hub/broken-links.md` — missing note (Wiki), missing note with alias
  (merges into the same finding), broken Markdown link (no fix action offered),
  missing attachment, missing heading, missing embed. Expected: five
  broken-link findings.
- `notes/hub/relative-and-unicode.md` — Unicode note link, Unicode embed,
  parent-relative Markdown link. Expected: zero findings.
- `notes/attachments-ref.md` — `source: "[[frontmatter-doc.pdf]]"` frontmatter
  reference plus a `![[photo.jpg]]` embed. Expected: zero findings; both
  attachments non-orphan.
- `notes/empty/*.md` — ten notes: genuine empty, stub (3 words), frontmatter
  only, title only, link-only MOC with 8 links (passes today), two-link MOC
  (reported today — FP), embed-only (reported today — FP), single-short-task
  note (reported today — FP), code-block note (passes), CJK stub (2 CJK
  "words", reported). Expected: eight empty-note findings.
- `notes/external-links.md` — seven URLs: one 200, four ≥ 400 statuses (404,
  403, 429, 500), one request-failure, one loopback address. Only scanned when
  the external-links pass enables that scanner.
- `canvas/board.canvas` — Obsidian Canvas JSON with one `file` node pointing at
  `attachments/canvas-image.png`.
- `attachments/` — `photo.jpg`, `frontmatter-doc.pdf`, `canvas-image.png`,
  `orphan.png`, `recent-orphan.png`, `目标图片.png`.
- `duplicates/` — hash-identical pair (`original/fixture-data.bin`,
  `backup/fixture-data.bin`), same-name/different-content pair (`notes-a.txt`,
  `archive/notes-a.txt`), same-size/different-content pair (`size-twin-one.bin`,
  `size-twin-two.bin`, both 48 bytes).

Determinism rules (enforced by the loader and an implementation-time size
audit):

- All file contents are fixed literals; attachment "binaries" are plain text
  (scanners hash bytes, they never decode).
- Every file has a distinct byte size except the two intended duplicate pairs;
  incidental same-size collisions would surface as extra duplicate findings and
  break the inventory snapshot, so the audit step verifies uniqueness.
- All mtimes are pinned by the loader to `Date.UTC(2020, 0, 1)` so orphan
  severity is deterministically `warning`; `recent-orphan.png` is overridden to
  `Date.now() - 60_000` so it is deterministically `info` (the 7-day recency
  window cannot flip within a test run).

### Loader: `src/tests/helpers/fixture-vault.ts`

`scanFixtureVault(options)` reuses `createLocalApp` from `cli/local-vault.ts`
(the shipped CLI adapter) so plugin scanner tests and CLI scans are guaranteed
identical reference semantics. Steps:

1. `createLocalApp(fixtureRoot)` — real files, real parsing.
2. Pin `stat.mtime`/`stat.ctime` on every returned `TFile` (default past,
   per-path overrides).
3. Merge options into `structuredClone(DEFAULT_SETTINGS)`.
4. Build a `ScanRunner` with the caller's `requestUrl` stub and real
   `setTimeout`/`clearTimeout` (the external-links scanner's timeout race needs
   timers under Node; there is no `window` in vitest's node environment).
5. Register default scanners, run once, return `{ root, settings, result }`.

The roadmap listed `src/tests/helpers/scan-context.ts` under files to modify;
this design keeps that helper untouched because the fixture loader builds
contexts through the real runner rather than the synthetic-metadata path, and
existing unit tests continue to use `makeScanContext` unchanged.

### Precision suite: `src/tests/scanner-precision.test.ts`

Five sections:

1. **Focused per-scanner assertions** — for each documented case: the finding
   exists with expected severity, classification, key evidence (e.g.
   `wordCount`, `status`, `lastModified`), and fix-action availability — or no
   finding exists for the negative cases. Intent stays readable.
2. **Exact inventory snapshot** — every finding mapped to
   `scannerId | severity | classification | sorted paths | message`, sorted,
   compared against a pinned 19-entry array (default-settings pass,
   external-links disabled). Any behavior change anywhere in the pipeline
   surfaces here.
3. **Fingerprint stability** — scan twice, assert the full serialized issue
   lists (including fingerprints) are identical.
4. **External-links pass** — second scan with external-links enabled and an
   injected `requestUrl` stub mapping each fixture URL to its status (the
   failure URL rejects). Asserts: 200 → no finding; 404/403/429/500 → four
   identical "Dead external link" candidate/warning findings (documenting the
   Milestone 1 target); request failure and loopback block → `unverified`
   findings. No network is touched.
5. **Hash-cap pass** — third scan with `duplicateHashMaxBytes: 8`: the 56-byte
   hash-identical pair is no longer hashed and degrades to a same-name `info`
   candidate with no keep-one fix; the other duplicate findings are unchanged.

If actual output differs from the documented inventory during implementation,
the rule is: fix the fixture (content/size collision) or correct the
documentation-derived expectation only after confirming the scanner truly
behaves that way — never weaken an assertion to make a surprise pass.

### Performance baseline

**Generator** (`src/tests/helpers/synthetic-vault.ts`): pure function of
`(vaultDir, { notes, attachments, seed })` using a seeded LCG (fixed default
seed). Produces notes with frontmatter-free deterministic prose, 1–3 valid Wiki
Links, ~30% one broken link, ~25% an attachment embed, ~15% a Markdown relative
link; deterministic-size attachments (1–9 KB); one 2 KB hash-identical pair;
pinned mtimes. Same seed → identical vault, byte for byte.

**Benchmark script** (`scripts/benchmark-scan.mjs`): plain Node 18-compatible
ESM. It cannot import the TypeScript sources directly (no extensioned
specifiers, no experimental flags), so it uses the existing `esbuild`
devDependency to bundle a five-line re-export entry (`createLocalApp`,
`ScanRunner`, `registerDefaultScanners`, `DEFAULT_SETTINGS`,
`generateSyntheticVault`) into a temp file and imports it. For each run: build
the adapter, wrap `vault.readBinary` (hash reads) and `vault.cachedRead`
(content reads) with counters, run all default scanners (external-links is
already disabled by default), time with `performance.now()`. Default 550 files
(400 notes, 150 attachments), 3 runs, median reported. Flags: `--notes`,
`--attachments`, `--runs`, `--json`, `--keep`. Output ends with a one-line
summary suitable for pasting into PR descriptions. The synthetic vault is
created in `os.tmpdir()` and removed afterwards.

**CI gate** (`src/tests/scan-performance.test.ts`): 160-file synthetic vault,
one run, asserts completion, correct `filesScanned`, external-links excluded,
at least one finding, and duration < 30 000 ms — generous by design; it exists
to catch order-of-magnitude regressions (e.g. accidental O(n²) resolution), not
noise. **Local gate**: `npm run benchmark:scan` before/after a change; the
roadmap's 15% median-scan-duration budget is reviewed manually and the summary
lines are quoted in the PR.

## Risks and mitigations

- **Inventory expectations drift from real scanner output** during
  implementation (message wording, ordering). Mitigation: the reconcile rule
  above — surprises are investigated against scanner source, not absorbed.
- **Git/OS Unicode filename handling** (`目标笔记.md`). Git stores UTF-8 paths
  natively; macOS/Linux CI are fine. If a Windows contributor clones with
  core.autocrlf quirks the risk is line endings, not names; fixture content
  avoids CRLF-sensitive parsing.
- **Timing flake in the CI perf test** on slow runners. Mitigation: 30 s bound
  against a sub-second workload and a 120 s test timeout; the assertion is a
  smoke gate, precise comparison stays local.
- **Benchmark bundle step adds moving parts** (esbuild API). Mitigation: the
  entry is five re-export lines; if esbuild's stdin API breaks, the failure is
  immediate and loud on every benchmark run, not silent.

## Acceptance criteria (from roadmap Milestone 0)

- Existing tests and the new precision suite pass.
- Supported reference paths have explicit true-positive and negative cases
  (valid-links, relative-and-unicode, frontmatter, and the broken variants).
- Candidate and unverified cases name their detection boundary (Canvas orphan,
  short MOC, embed-only, task note, 403/429/500 presentation, loopback block).
- No production telemetry or runtime dependency is introduced (package.json
  gains only the `benchmark:scan` script).
- Benchmark output is reproducible from a clean checkout (seeded generator,
  pinned mtimes, median of N runs).
