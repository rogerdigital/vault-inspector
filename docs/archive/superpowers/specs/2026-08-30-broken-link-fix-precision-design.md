# Broken Link Fix Precision Design (Milestone 1, Task 1.5)

Date: 2026-08-30
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.5)
Depends on: PR #125 (post-merge `broken-links.ts`: candidates key by `reference.link`, full wiki inner text survives only as `fixLinkText`)

## Problem

The broken-links scanner attaches a `remove-link-text` fix action that the
executor resolves by regex `!?\[\[<linkText>\]\]` and deletes outright
(`src/fix/fix-executor.ts`). Two failures:

- **Readable text is destroyed.** `[[Missing|Readable label]]` is removed
  entirely, taking the label with it; `[Readable label](missing)` gets no fix
  action at all, so the markdown case cannot even be attempted safely; a
  missing embed `![[missing.png]]` is handled only because the wiki pattern
  happens to prefix-match with `!?`.
- **The action is under-specified.** `linkText` is inner wiki text, not the
  literal source range. After PR #125 a candidate keyed by `reference.link`
  can merge a plain reference (`[[Missing Note]]`) with an aliased one
  (`[[Missing Note|Readable Label]]`) — the merged finding keeps the first
  reference's `fixLinkText`, so executing it removes the plain occurrence and
  leaves the aliased one behind, silently fixing half the problem. The action
  metadata cannot express "replace this exact syntax with this text".

Evidence also collapses the failure modes into one shape: `{ link, target }`
cannot distinguish a missing note, a missing attachment, a missing heading, a
markdown-syntax link, or an embed without parsing the message string.

## Goals

- Roadmap transformation table, exactly:

  ```text
  [[Missing|Readable label]] -> Readable label
  [[Missing]]                -> Missing
  [Readable label](missing)  -> Readable label
  ![[missing.png]]           -> removed embed
  ```

  Heading variants follow the same rule: `[[target#Missing Heading]]` becomes
  `target#Missing Heading`; `[[target#Missing Heading|alias]]` becomes
  `alias`. Markdown embeds `![alt](missing.png)` are removed like wiki embeds.

- Fix actions carry the exact source syntax and the replacement text as
  structured, additive `FixAction` fields (`original`, `replacement`); the
  executor matches the literal `original` instead of reconstructing a wiki
  pattern. `linkText` stays for compatibility and for the legacy wiki path.
- No replacement action when the source range is ambiguous: a merged candidate
  whose references have differing (or partially missing) `original` values
  gets no `fixAction` — the finding stays reviewable.
- Protected regions (fenced code, inline code, HTML comments) keep being
  skipped; the new literal matching reuses the existing
  `findProtectedMarkdownRanges`.
- Evidence gains a `linkKind` scalar distinguishing `embed`, `attachment`,
  `markdown-link`, `heading`, and `note-link`.
- `ignoreUnresolvedNoteLinks` semantics are byte-identical: only plain
  (non-embed, wiki) note links are ignorable; markdown links, attachments,
  headings, and embeds never are.
- Fingerprints stay byte-identical: `generateFingerprint("broken-links",
  sourcePath, { link, target })` — evidence and fix metadata never enter it.
- CLI JSON inherits `linkKind` evidence and the new fix-action fields
  additively (the scanner output is the same `Issue` objects the CLI
  serializes).

## Non-goals (this PR)

- No rewriting of links to corrected targets, no batch "remove all broken
  links" mode, no settings changes, no `ScanRunner` changes.
- No modification of the precision fixtures (`src/tests/fixtures/`
  precision-vault stays M0-frozen).
- No Milestone 1.6 (external-link status) work.

## Design

### FixAction additions (additive, optional)

`src/scanner/Issue.ts`:

```ts
export type FixAction = {
	kind: FixActionKind;
	label: string;
	description: string;
	targetPaths: string[];
	linkText?: string;
	/** Exact literal source syntax to locate (e.g. "[[Missing|Label]]"). */
	original?: string;
	/** Text substituted in place of `original`; "" removes the range. */
	replacement?: string;
	selection?: KeepOneSelection;
};
```

`original` is the verbatim `LinkCache.original` / `EmbedCache.original`
string (both Obsidian's real cache and the CLI adapter populate it — the
adapter's markdown entries carry `original: match[0]`, `cli/local-vault.ts`).
`replacement` is derived per syntax. The executor prefers
`original`/`replacement` when present and falls back to the legacy
`linkText` wiki pattern otherwise, so any persisted snapshot fix decisions
remain executable.

### Replacement derivation per syntax (scanner)

`getLinkCandidate` parses `reference.original`:

| Syntax of `original` | `original` field | `replacement` field |
|---|---|---|
| `![[inner]]` (embed) | verbatim incl. `!` | `""` (embeds render nothing, so removal is the only faithful transform) |
| `[[inner]]` (wiki) | verbatim | alias if `inner` contains `|` (text after the first `|`), else `inner` itself |
| `![alt](target)` (markdown embed) | verbatim incl. `!` | `""` |
| `[label](target)` (markdown) | verbatim | `label` |
| missing / other shape | — | no fix for this reference |

Wiki heading links fall out of the wiki rule: `target#Missing Heading` has no
`|`, so the replacement is the readable `target#Missing Heading` text as
plain prose; the aliased form keeps the alias.

The action label stays `"Remove link"` (renderers and unrelated tests treat
it as opaque); `description` becomes precise:
`Replace "[[Missing|Label]]" with "Label" in "Source.md"` or
`Remove "![[missing.png]]" from "Source.md"` (empty replacement).
`linkText` is still populated for wiki fixes (unchanged meaning: full inner
text) and omitted for markdown fixes, where wiki inner text does not exist.

### Ambiguity guard (merged candidates)

Obsidian's `LinkCache.link` strips aliases, so `[[Missing Note]]` and
`[[Missing Note|Readable Label]]` share the candidate key `Missing Note`.
The merge rule in `addCandidate` becomes: the merged candidate keeps a fix
only when **every** merged reference produced a fix with the **same**
`original`. Any disagreement (plain vs aliased, wiki vs markdown, one
reference lacking `original`) clears the fix — the finding survives without
an action. Rationale: one action can locate only one literal range, and
executing it against a merged group would remove some occurrences and leave
others, which is exactly the silent half-fix this PR exists to prevent.
Embed/note merges (`[[Missing]]` + `![[Missing]]`) have distinct originals by
the leading `!`, so they are also treated as ambiguous and withheld.

References discovered only through `unresolvedLinks` (no matching cache
entry, hence no `original`) already produce no fix today; that stays.

### Evidence distinction

`Issue.evidence` gains one scalar:

| `linkKind` | Condition (first match wins) |
|---|---|
| `embed` | any merged reference is an embed (wiki or markdown) |
| `attachment` | target has a known non-md extension (`isAttachmentLink`) |
| `markdown-link` | `original` is markdown syntax (starts with `[` but not `[[`) |
| `heading` | heading finding (target note resolves, heading does not) |
| `note-link` | everything else (plain wiki link to a missing note) |

Existing `link` and `target` evidence are unchanged, so the message set and
fingerprints are untouched.

### Executor changes

`src/fix/fix-executor.ts`:

```ts
case "remove-link-text": {
	const source = action.targetPaths[0];
	if (action.original !== undefined) {
		return replaceLinkText(app, source, action.original, action.replacement ?? "");
	}
	return removeLinkText(app, source, action.linkText!);
}
```

`replaceLinkText` mirrors `removeLinkText`: literal `escapeRegex(original)`
pattern, skip matches intersecting `findProtectedMarkdownRanges`, splice in
the replacement, return 1 if the file changed, else 0. Two guards:

- **Embed contamination.** A wiki `original` (`[[x]]`) is a substring of the
  embed (`![[x]]`), and a markdown `original` (`[a](b)`) of the image
  (`![a](b)`). The literal pattern is anchored with a negative lookbehind
  `(?<!!)` so non-embed actions never eat an embed, and embed actions carry
  the `!` in `original` and match exactly. (The legacy wiki path keeps its
  current `!?` behavior; changing it would alter old persisted decisions.)
- **Protected regions.** Unchanged — the same range finder gates both paths.

### `ignoreUnresolvedNoteLinks` preservation

`ignorableUnresolvedNote` keeps its exact post-#125 derivation: true only for
non-embed wiki links whose `original` starts with `[[`. Markdown-syntax
references are never ignorable regardless of target kind; the AND-merge
across same-key references is unchanged.

### Fingerprints and COMPARISON_VERSION

`generateFingerprint("broken-links", sourcePath, { link, target })` is
unchanged: `linkKind`, fix fields, and the ambiguity guard never enter it.
The guard only *removes* actions (never findings), and every finding that
survives today survives with the same fingerprint, so user ignore lists
survive. `COMPARISON_VERSION` stays `1`.

### Render/export impact

- `src/report/render-issues.ts`, `src/report/InspectorView.ts`,
  `src/fix/confirm-modal.ts` — no change: they read `kind`, `label`,
  `description`, `targetPaths` generically; an absent `fixAction` already
  renders review-only (established by the orphan/empty-note precision PRs).
- `src/report/markdown-export.ts` — no change; `linkKind` flows through the
  generic evidence disclosure.
- CLI JSON: additive (`linkKind` evidence scalar; `original`/`replacement`
  on fix actions; `fixAction` now appears on the markdown-link finding and
  disappears on the ambiguous merged finding). No stable field renamed or
  removed.

## Precision-suite impact

Fixture `notes/hub/broken-links.md` yields five findings; the reasoning:

- `EXPECTED_INVENTORY` lines are built from `scannerId | severity |
  classification | paths | message` — none of which change. **Inventory stays
  15 lines, byte-identical.**
- `Missing Note` (plain + aliased merged): originals differ
  (`[[Missing Note]]` vs `[[Missing Note|Readable Label]]`) → the fixAction
  the suite pins today (`linkText: "Missing Note"`) becomes `undefined`.
  Assertion update, not an inventory change.
- `missing-target.md` (`[Readable Markdown](missing-target.md)`): both the
  CLI adapter and real Obsidian `LinkCache` carry `original`, so the roadmap
  transform is feasible — the finding gains `fixAction`
  `{ original: "[Readable Markdown](missing-target.md)", replacement:
  "Readable Markdown" }`. Assertion update.
- `missing-photo.png`, `missing-embed.png`, `target#Missing Heading`: fix
  actions now additionally carry `original`/`replacement`
  (`missing-photo.png` → replaced by `missing-photo.png` text;
  `![[missing-embed.png]]` → removed; `[[target#Missing Heading]]` →
  replaced by `target#Missing Heading`). Assertions tightened.

## Test strategy

- `src/tests/broken-links.test.ts` — update the two tests whose behavior
  legitimately changes ("does not offer a wiki removal action for Markdown
  links" now offers a markdown replacement; "merges plain and aliased …"
  now withholds the action as ambiguous) and add coverage: alias
  preservation, plain-link replacement, markdown label preservation, embed
  removal, heading replacement, ambiguity guard (differing originals,
  one-sided missing original), `linkKind` for all five kinds, and
  `ignoreUnresolvedNoteLinks` interactions (kept tests).
- `src/tests/fix-executor.test.ts` — existing aliased-heading action now
  carries `original`/`replacement`; expected outputs change from "line
  removed" to "label left in place"; the embed line is no longer
  collateral-damaged by the `(?<!!)` guard; add literal-replacement,
  markdown-label, embed-removal, and legacy-`linkText` fallback cases; keep
  the protected-region case.
- `src/tests/scanner-precision.test.ts` — assertion updates only (fixture
  files unchanged), per the impact section above.

## Verification strategy

```bash
npm test -- src/tests/broken-links.test.ts src/tests/fix-executor.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: supported fixes preserve readable content and never modify
protected Markdown regions; the precision inventory stays 15 lines.

## Risks

- **The merged `Missing Note` finding loses its one-click fix**: intended —
  executing the old action removed only the plain occurrence and silently
  left the aliased one; ambiguous merges stay reviewable, and unmerged
  singles (the overwhelmingly common case) keep their action.
- **Markdown-link fix actions are new**: the action replaces the link with
  its label text, which is what the roadmap specifies; if the label is empty
  (`[](missing)`) the replacement is `""` (removal).
- **Lookbehind regex**: `(?<!!)` requires ES2018+, supported by Obsidian's
  Electron renderer and every Node version the CLI targets.
- **Persisted fix decisions from old snapshots** only ever carried
  `linkText`; the executor's legacy fallback keeps them executable exactly as
  today.
