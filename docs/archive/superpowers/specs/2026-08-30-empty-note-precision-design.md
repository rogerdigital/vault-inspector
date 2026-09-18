# Empty Note Precision Design (Milestone 1, Task 1.4)

Date: 2026-08-30
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.4)
Depends on: `docs/superpowers/specs/2026-08-30-reference-index-design.md` (merged — `ctx.referenceIndex` exists), `docs/superpowers/specs/2026-08-30-orphan-attachment-precision-design.md` and `docs/superpowers/specs/2026-08-30-duplicate-file-precision-design.md` (merged — inventory is 18 lines)

## Problem

The empty-notes scanner (`src/scanner/scanners/empty-notes.ts`) reduces a note
to a single scalar: the prose word count of its body after frontmatter and
title removal (`countWords`, CJK-aware). A note is reported when
`wordCount <= ctx.emptyNoteWordThreshold`. Notes whose meaning lives in
structures rather than prose are false positives:

- **Link-only MOCs.** `notes/empty/short-link-moc.md` (`[[target]]
  [[sibling-note]]`) reports as "2 words".
- **Embed-only notes.** `notes/empty/embed-only.md` (`![[photo.jpg]]`) reports
  as "1 word".
- **Task notes.** `notes/empty/task-note.md` (`- [ ] Fix docs`) reports as
  "5 words" — the `[` / `]` brackets inflate the whitespace-token count while
  the actual meaning (a task) is invisible to it.

The scanner is also reference-blind: it attaches a `trash-file` fix action to
every finding, including stubs that other notes deliberately link to. Deleting
a referenced stub breaks live links, and the scanner gives no signal that the
stub plays a role somewhere else in the vault. The shared reference index
(`getInboundReference` in `src/scanner/reference-index.ts`) is already on the
context and unused here.

## Goals

- Count meaningful structures independently from the prose word count:
  internal links and embeds; Markdown task items; non-empty list items;
  non-empty fenced code blocks; and other non-prose visible block content
  (tables, Markdown/HTML images) after frontmatter and title removal.
- A note is reported as empty only when BOTH `wordCount <=
  ctx.emptyNoteWordThreshold` AND `structureCount === 0`. Link-only MOCs,
  embed-only notes, and task notes stop being reported; title-only,
  frontmatter-only, and genuinely empty notes remain candidates.
- Evidence carries `wordCount`, `structureCount`, and
  `inboundReferenceCount` (from the reference index), alongside the existing
  `size`.
- A stub with any inbound reference (`inboundReferenceCount > 0`) keeps its
  finding but loses its `trash-file` fix action: it stays reviewable and can
  never be part of a low-risk bulk delete. Mirrors the coverage-gating
  precedent from the orphan PR (fix eligibility derived from reference-index
  trust), applied to inbound instead of coverage state.
- CJK word-count behavior stays covered: CJK characters keep counting as
  words, so a prose-only CJK stub is still detected, and CJK link text counts
  as structure like any other link.
- Fingerprints stay byte-identical: `generateFingerprint("empty-notes",
  file.path, {})` — evidence never enters it, so user ignore lists survive.

## Non-goals (this PR)

- No threshold semantics change: `emptyNoteWordThreshold` keeps its meaning
  (prose word count) and default; the new structure gate is additive.
- No new fix-action kinds, no reference rewriting, no settings changes, no
  CLI changes. CLI JSON inherits the new evidence fields verbatim
  (additive scalars).
- No prose-quality analysis (sentence counting, heading density), no
  per-structure-type breakdown in evidence (a single `structureCount` scalar
  keeps evidence renderable by the generic disclosure).
- No broken-link, external-link, or Milestone 2 work.

## Design

### Structure counting algorithm

New pure export `countMeaningfulStructures(body: string): number` in
`src/scanner/scanners/empty-notes.ts`, operating on the same body the word
count uses (after `stripFrontmatterAndTitle`):

1. **Internal links and embeds.** Every `[[...]]` occurrence with non-empty
   content (`/\[\[[^\]]+\]\]/g`) counts once, wherever it appears — inline,
   in a list item, or standalone. `![[embed]]` matches too (the `!` is
   outside the brackets). A link inside a list item is therefore visible in
   both categories; `structureCount` is a count of meaning indicators, not a
   partition, and only `=== 0` gates reporting.
2. **Fenced code blocks.** Line-driven fence tracking on `^(```|~~~)` of the
   trimmed line. A fence pair whose inner lines contain at least one
   non-blank line counts once. An unterminated fence counts nothing — its
   text is already fully counted by `countWords`, so detection is not lost.
3. **Task items.** A trimmed line matching `^[-*+]\s+\[[ xX]\]` or
   `^\d+[.)]\s+\[[ xX]\]` counts once.
4. **Non-empty list items.** Any other trimmed line matching `^[-*+]\s+\S`
   or `^\d+[.)]\s+\S` counts once.
5. **Other non-prose visible blocks.** Table blocks (a run of consecutive
   trimmed lines matching `^\|.*\|`) count once per block; Markdown images
   (`![alt](target)`) and `<img ...>` lines count once each.

**Plain prose paragraphs deliberately count zero structures.** The roadmap's
"other visible block content after frontmatter and title removal" cannot
mean paragraphs: paragraphs are exactly what `countWords` already measures,
so counting them would make every stub "structural" — `stub.md` ("Real stub
note.") and `cjk-stub.md` ("你好") are single paragraphs and would vanish
from detection. The structure gate therefore captures only content kinds
whose meaning the prose word count underrepresents; this is documented in
the code comment on `countMeaningfulStructures`.

CJK handling: `countMeaningfulStructures` is script-agnostic — a link with
CJK target text (`[[目标笔记]]`) counts as a link; a prose-only CJK stub
counts zero structures and is still detected by the CJK-aware word count.

### Detection rule and evidence shape

```ts
if (wordCount <= ctx.emptyNoteWordThreshold && structureCount === 0) { ... }
```

`Issue.evidence` gains two scalars (all values are `string | number |
boolean`, no arrays):

| Field | Type | Meaning |
|---|---|---|
| `size` | number | unchanged |
| `wordCount` | number | unchanged (CJK-aware prose count) |
| `structureCount` | number | links/embeds + tasks + list items + non-empty code fences + non-prose blocks |
| `inboundReferenceCount` | number | `getInboundReference(ctx.referenceIndex, file.path)?.count ?? 0` |

`why` now names the structure dimension:
`The note contains N meaningful word(s) and no meaningful structures (links,
embeds, tasks, list items, or code blocks), at or below the configured
threshold of T.`

### Fix suppression for referenced stubs

Threshold: **any** inbound reference (`inboundReferenceCount > 0`) suppresses
the `trash-file` fix action. Rationale: a single deliberate link is enough to
make "bulk delete this stub" unsafe — there is no count at which breaking one
live link is acceptable to an automated flow, and the finding itself is
untouched, so the user can still review and manually delete. This mirrors the
orphan PR's shape exactly: the scanner conditionally spreads the `fixAction`
based on reference-index state instead of always emitting it, and `nextStep`
explains the gate:

- Unreferenced (unchanged): `Add meaningful content, ignore the finding, or
  move the note to trash after review.`
- Referenced: `This stub is referenced by N inbound link(s). Review why it is
  referenced before adding content or deleting it.`

The confirmation modal, fix decisions, and executor need no changes: an
absent `fixAction` already renders as review-only everywhere (same as
candidate duplicate findings and incomplete-coverage orphans).

### Fingerprints and COMPARISON_VERSION

`generateFingerprint("empty-notes", file.path, {})` is unchanged: neither the
new evidence nor the structure gate nor fix suppression enters it, so
fingerprints of remaining findings are byte-identical and **user ignore
lists survive**. Three findings genuinely disappear
(`short-link-moc.md`, `embed-only.md`, `task-note.md`) — that is the intended
false-positive fix, not an identity change; old snapshots diff against a new
scan by showing those three as resolved, which is accurate. Suppressed
`fixAction`s are not part of snapshot identity. `COMPARISON_VERSION` stays
`1` (`src/snapshot/scan-snapshot.ts`) per the roadmap rule: old snapshots are
not misleading — the diff they produce is the true behavioral delta.

### Render/export impact

- `src/report/render-issues.ts` — **no change**. The empty-notes branch reads
  `evidence.wordCount` for the message; new fields render through the generic
  evidence disclosure. Absent `fixAction` hides the fix button via existing
  handling.
- `src/report/markdown-export.ts` — **no change**. `getMarkdownDetails` for
  empty notes reads `wordCount`; the new scalars stay in the evidence
  disclosure and CLI JSON.
- CLI JSON inherits `structureCount` and `inboundReferenceCount` additively;
  no stable field is renamed or removed. `fixAction` simply being absent for
  referenced stubs matches how other scanners already emit optional actions.

## Test strategy

- `src/tests/empty-notes.test.ts` — rewritten `makeCtx` seeds
  `referenceIndex` (today it omits the field); new cases: link-only MOC,
  embed-only, task-only, list-only, and code-fence-only notes are not
  reported; title-only/frontmatter-only/empty remain reported with
  `structureCount: 0`; referenced stub keeps the finding but has no
  `fixAction` and carries `inboundReferenceCount` plus the review
  `nextStep`; unreferenced stub keeps its `trash-file`; fingerprint is
  stable across reference-count changes; CJK prose stub still detected; the
  full `countWords` suite stays; a new `countMeaningfulStructures` unit
  describe pins the per-category counting (including CJK link text, fence
  content gating, table block grouping).
- `src/tests/scanner-precision.test.ts` — updated, fixture files unchanged
  (M0-frozen evidence base):
  - `EXPECTED_INVENTORY` drops the three FP lines: 18 → 15 lines.
  - The "eight stub notes" test becomes five stub notes (cjk-stub,
    frontmatter-only, genuine-empty, stub, title-only).
  - Fix-availability splits out: the four stubs linked from
    `link-only-moc.md` (inbound count 1) have no `fixAction`; `cjk-stub.md`
    (unreferenced) keeps `trash-file`.
  - The "keeps structural notes out" test adds `short-link-moc.md`,
    `embed-only.md`, and `task-note.md` to the exclusion list.
  - The "pins the known false positives with their word counts" test is
    replaced: the three former FPs no longer produce empty-notes findings,
    so their word counts are unobservable through this scanner — the
    structural-exclusion assertions carry that responsibility, and the
    remaining pins (`cjk-stub.md` = 2, `stub.md` = 3) stay.

## Verification strategy

```bash
npm test -- src/tests/empty-notes.test.ts src/tests/scanner-precision.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: structural notes (MOCs, embeds, tasks, lists, code) are preserved
while genuine empty notes and prose stubs are still detected; referenced
stubs remain reviewable without a trash action; the precision inventory is
15 lines. Full gates green.

## Risks

- **Three findings disappear for existing users**: intended; their
  fingerprints simply never fire again, ignore lists stay valid, and
  snapshot diffs correctly show them resolved.
- **Referenced stubs lose their one-click delete**: intended per the roadmap
  ("cannot be treated as a low-risk bulk-delete candidate"); the finding,
  severity, and classification are unchanged, only the action is withheld,
  and the user can still delete manually from Obsidian.
- **Prose-paragraph exclusion is a judgment call**: a note whose only content
  is, say, a single blockquote line of prose stays a stub candidate. That is
  the correct boundary — the word count already measures prose — and the
  code comment documents it.
