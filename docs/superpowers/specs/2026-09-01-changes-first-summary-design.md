# Changes-First Summary Design (Milestone 3, Task 3.2)

Date: 2026-09-01
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 3, Task 3.2)
Predecessors: `docs/superpowers/specs/2026-09-01-scan-history-design.md` (Task 3.1, merged — `acceptScanResult` in `src/main.ts` computes the `LifecycleComparison` and passes it to `view.setResult`), plus the lifecycle comparison itself (`compareScanResult`, `src/scanner/result-diff.ts`, Milestone 1)

## Problem

The report summary (`renderSummary`, `src/report/render-summary.ts`) leads with
aggregate state: an "Active" total first, then New / Persisting / Resolved
only when a comparison exists, and a bare reason line when it does not. After
a scan, the user's first question is "what changed?" — did anything new break?
— not "how many total findings exist?". The current order answers the second
question first, buries new confirmed findings (the ones that most deserve
review) inside the aggregate total, and gives no way to jump straight to them.
When comparison is unavailable, the summary says why but not when the previous
successful scan ran, so the user cannot tell how stale the baseline is.

The roadmap's requirement: new confirmed errors and warnings appear before
aggregate totals; persisting and resolved counts from the last compatible scan
appear alongside them; the previous successful scan time and the
unavailability reason are both shown; a `Review new findings` control reaches
the new findings without silently hiding other results; ignored findings stay
active in lifecycle comparison; resolved entries stay historical and
non-actionable.

## Goals

The roadmap's required behavior, restated as where each guarantee lives:

- **New confirmed errors and warnings before aggregate totals** —
  `renderSummary` renders a `What changed` panel (`div.vi-changes`) as the
  first child of the summary, before the aggregate `vi-stats` block. The panel
  leads with `New errors` and `New warnings` counts, computed by a new pure
  helper `countNewConfirmedFindings` in `src/report/report-model.ts` (status
  `new` AND classification `confirmed`, split by severity `error` /
  `warning`). The aggregate block keeps only `Active`; the meta row keeps
  files / duration / scanners / ignored.
- **Persisting and resolved counts from the last compatible scan** — the same
  panel shows `Persisting` (count over active issues with status
  `persisting`, exactly the existing headline count) and `Resolved`
  (non-ignored `resolvedIssues`, exactly the existing headline count). When
  comparison is unavailable, the panel shows neither, matching today's
  semantics: an unavailable comparison claims no lifecycle facts.
- **Previous successful scan time AND why comparison is unavailable** —
  `LifecycleComparison` (`src/scanner/result-diff.ts`) gains an optional
  `previousScanAt?: number`, set to the baseline snapshot's `createdAt`
  whenever a snapshot exists — including the incompatible cases
  (`semantics-changed`, `settings-changed`), because the user still wants to
  know when the vault was last successfully scanned. When comparison is
  available, the panel reads it as a `Compared with the scan from <time>`
  meta line; when unavailable, the existing `vi-comparison-note` appends
  `(previous successful scan: <time>)` to the reason. A first scan has no
  snapshot, so no time is shown — only the reason.
- **A `Review new findings` control that does not silently hide anything** —
  the panel renders a `Review new findings (N)` button (N = new confirmed
  errors + new confirmed warnings; the button is omitted when N is 0 or the
  callback is absent). Clicking it applies the EXISTING facet filters —
  `filterStatus = "new"`, `filterClassification = "confirmed"`, and
  `filterSeverity = null` — through `InspectorView`'s filter state. Nothing is
  hidden silently: the toolbar's lifecycle / classification chips show the
  active state, every other chip (All, scanner, severity, the other statuses)
  remains clickable to widen or narrow the view, and clicking the control
  again toggles the filters off. It is a composed preset over the existing
  filter model, not a separate display mode.
- **Ignored findings stay active in lifecycle comparison** — unchanged by
  construction: `compareScanResult` already populates `statuses` for ignored
  findings, the ignored list already renders status badges from the same
  map, and resolved counting already treats a finding that moved to ignored
  as NOT resolved. No scanner, fingerprint, or diff semantics change; this
  task only re-orders what the summary leads with.
- **Resolved entries stay historical and non-actionable** — the resolved
  section and `renderResolvedChanges` (`src/report/render-changes.ts`) are
  untouched: resolved findings remain read-only `SnapshotIssue`s rendered
  without actions, never passed to active or ignored issue lists, and the
  `Resolved` headline stat stays a non-clickable div.

## Non-goals (this PR)

- No history browsing UI — the scan history from Task 3.1 is not surfaced;
  only the baseline snapshot's `createdAt` (via `previousScanAt`) is shown.
- No change to `compareScanResult`'s comparison semantics, fingerprints,
  `COMPARISON_VERSION`, snapshot shape, or scan history — this task adds one
  informational field to the comparison result and re-orders summary
  rendering.
- No change to sorting (`compareIssues` already ranks new confirmed findings
  first), the toolbar chips, issue rendering, fix flows, or the ignored and
  resolved sections.
- No settings additions and no CLI change — the summary is view-only; the
  npm package's JSON/Markdown output is untouched.

## Design

### Section ordering inside the summary

`renderSummary` renders, in order:

1. `h2` "Scan results" (unchanged).
2. `div.vi-changes` — the `What changed` panel (new).
3. `div.vi-stats` — the aggregate block, now only `Active`.
4. `div.vi-meta` — files scanned / duration / scanners / ignored (unchanged).

The aggregate block keeps a single `Active` stat because New / Persisting /
Resolved are lifecycle facts and now live where lifecycle facts live. The
`vi-stat-*` class vocabulary is reused inside the changes panel
(`vi-stat-new vi-stat-error`, `vi-stat-new vi-stat-warning`,
`vi-stat-persisting`, `vi-stat-resolved`) so existing severity coloring and
the shared stat markup apply.

### The What changed panel

When comparison is available:

- A meta line: `Compared with the scan from <formatted time>` (or `Compared
  with the previous successful scan` if `previousScanAt` is somehow absent).
  Time formatting is `new Date(ms).toLocaleString()` — the user's locale,
  like every other human-readable string in the view.
- A stats row: `New errors` (confirmed + new + error), `New warnings`
  (confirmed + new + warning), `Persisting` (button — keeps the existing
  `onFilterStatus("persisting")` headline filtering, now the only lifecycle
  status the summary filters directly, since `new` is covered by the review
  control), `Resolved` (non-clickable div). New/Persisting headline counts
  cover active issues only — ignored findings are already represented by the
  `Ignored` meta count and by status badges in the ignored list.
- A `Review new findings (N)` button when N > 0 and the callback exists.

When comparison is unavailable: the existing `vi-comparison-note` with the
existing reason message, appended with `(previous successful scan: <time>)`
when `previousScanAt` is present. No lifecycle stats are shown — the
unavailable comparison does not know any.

### Where the previous scan time comes from

`LifecycleComparison` gains `previousScanAt?: number`. `compareScanResult`
sets it to `snapshot.createdAt` on every branch where a snapshot exists:
available comparisons, `semantics-changed`, and `settings-changed`. The
`first-scan` path (null snapshot) omits it. The field is optional so every
existing fixture and the view's initial model remain valid; the view and
summary read it defensively (`undefined` → no time shown).

The alternative — deriving the time in `InspectorView` from plugin state —
would require threading a new value through `setResult` or a new setter,
duplicating what the comparison already knows. The comparison IS the object
that describes "compared against what"; carrying the baseline's timestamp in
it is the direct expression of the requirement.

### The Review new findings control

`SummaryOptions` gains `onReviewNewFindings?: () => void`. `InspectorView`
passes a toggle:

- apply: `filterStatus = "new"`, `filterClassification = "confirmed"`,
  `filterSeverity = null` (clearing a stale severity filter guarantees the
  preset shows ALL new confirmed findings — both severities — instead of a
  silently narrowed subset);
- release: clicking again restores `filterStatus = null` and
  `filterClassification = null`.

"Without silently hiding" rests on three properties, all already true of the
filter model: the toolbar chips render the active state (`vi-active`) so the
reduction is visible; the chips (including the `new (N)` lifecycle chip and
`All` scanner chip) remain present and clickable to widen the view; and the
summary's own headline counts (Active, Persisting) keep showing global
numbers, so the filtered list is obviously a subset. `setResult`'s existing
filter-reset logic already clears stale `filterStatus` /
`filterClassification` on the next scan, so the preset never survives into an
incompatible result set.

### Semantics deliberately unchanged

- Ignored in lifecycle: `compareScanResult` covers `ignoredIssues` in
  `statuses`; a finding that moves active→ignored stays `persisting`, never
  `resolved`. Verified by existing `result-diff.test.ts` tests; untouched.
- Resolved historical and non-actionable: `renderResolvedChanges` renders
  read-only snapshot findings; `renderResolvedSection` gates on
  `comparison.available`; `InspectorView` never passes `resolvedIssues` to
  `renderIssueList`. All untouched (pinned by existing
  `render-changes.test.ts` and `inspector-view-filters.test.ts` tests).
- Issue ordering: `compareIssues` already surfaces new confirmed findings
  first, so the review preset lands on an already-prioritized list.

## Documented deviations from the roadmap file list

- `src/scanner/result-diff.ts` and `src/tests/result-diff.test.ts` ARE
  modified (the roadmap omitted them). The previous-scan-time requirement
  needs a carrier from the acceptance path to the view; `LifecycleComparison`
  is that carrier, and `compareScanResult` is its only producer. The change
  is additive and informational: one optional field, zero behavioral change
  to statuses or resolved counting.
- `src/tests/main.test.ts` IS modified (four `toHaveBeenCalledWith` exact
  assertions on `view.setResult` gain `previousScanAt: 100`, matching the
  fixture snapshots' `createdAt`). The comparison object now carries the new
  field on those paths; the pinned assertions cannot survive without it.
- `src/report/render-changes.ts` and `src/tests/render-changes.test.ts` are
  NOT modified. The roadmap suggested checking what render-changes already
  does: it renders the RESOLVED section's read-only items — already compliant
  with "resolved entries historical and non-actionable" — and needs nothing
  for a summary-ordering change.

## Test strategy

- `src/tests/render-summary.test.ts` (rewritten expectations) pins:
  - new confirmed errors and warnings lead the summary, before `Active`
    (DOM-order assertion via flattened text indices), with candidate/unverified
    new findings excluded from the headline counts;
  - persisting and resolved counts shown from an available comparison,
    resolved still excluding ignored resolved findings;
  - the persisting stat remains a native button filtering via
    `onFilterStatus("persisting")`; new/warning/resolved stats are not
    buttons;
  - the `Review new findings (N)` button: present with the correct count,
    calls `onReviewNewFindings`, omitted at N = 0 and without a callback;
  - unavailable comparisons: the three existing reason messages, now with the
    previous scan time appended when `previousScanAt` is present and absent
    on first scan; no lifecycle stats are rendered;
  - aggregate meta (files / duration / scanners / ignored) unchanged.
- `src/tests/inspector-view-filters.test.ts` (extended) pins:
  - the summary options now include `onReviewNewFindings` (existing
    exact-equality assertion updated);
  - applying the review preset sets the status/classification filters and
    clears a stale severity filter, narrowing the issue list to new confirmed
    findings; clicking again releases the filters and restores the full list;
  - existing headline-toggle, facet-retention, and unavailable-comparison
    tests continue to pass unchanged.
- `src/tests/result-diff.test.ts` (extended) pins:
  - `previousScanAt` equals the baseline `createdAt` for available
    comparisons and for `settings-changed` / `semantics-changed`, and is
    absent on first scan; two existing exact-equality expectations gain the
    field.

## Verification strategy

```bash
npm test -- src/tests/render-summary.test.ts src/tests/inspector-view-filters.test.ts src/tests/result-diff.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: users can reach new confirmed findings directly (the review preset
and the persisting headline remain the only summary-driven filters) while all
current and historical states retain their existing semantics (ignored
statuses, resolved read-only, unavailable comparisons claim no lifecycle
facts).

## Precision-suite and CLI impact

None. The precision fixture suite observes scanner behavior, which is
untouched. The CLI never renders the summary and never constructs a
`LifecycleComparison` for display; `cli/` is unmodified and no stable CLI
field moves. Fingerprints and `COMPARISON_VERSION` are unchanged.

## Risks

- **`vi-stats` shrinks to one stat.** Users accustomed to the four-stat row
  see the numbers move, not disappear — every number still renders, earlier.
  The classes are reused, so themes and mobile styles keep working.
- **Locale-formatted time strings.** `toLocaleString()` output varies by
  locale, so tests assert the prefix (`Compared with the scan from`,
  `previous successful scan:`), never the formatted time itself.
- **Optional field drift.** `previousScanAt` being optional means a future
  producer could forget it; the view degrades to the current behavior (no
  time shown) rather than rendering a wrong time, and `result-diff.test.ts`
  pins the producer.
