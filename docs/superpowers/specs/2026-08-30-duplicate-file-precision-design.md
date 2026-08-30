# Duplicate File Precision Design (Milestone 1, Task 1.3)

Date: 2026-08-30
Status: Proposed
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.3)
Depends on: `docs/superpowers/specs/2026-08-30-reference-index-design.md` (merged — `ctx.referenceIndex` exists), `docs/superpowers/specs/2026-08-30-orphan-attachment-precision-design.md` (merged — inventory is 18 lines)

## Problem

The duplicate-files scanner keeps its three-phase design (name prefilter → size
prefilter → size-capped SHA-256), but its evidence and keep policy are shallow:

- **No hash-state honesty.** Phase 3 (`src/scanner/scanners/duplicate-files.ts`)
  silently `continue`s on read errors and silently skips above-cap files. A
  same-name/same-size candidate finding never says WHY hashing did not confirm
  or refute it: was the file above the cap, or did reading it fail? Users and
  the CLI's automation fields cannot distinguish "compared, different content"
  from "not comparable".
- **No reference awareness.** Evidence carries only `count` and `paths`. The
  automatic keep mode picks the lexicographically first path, so it will happily
  propose trashing the copy that three notes link to while keeping an
  unreferenced backup. The shared reference index
  (`getInboundReference` in `src/scanner/reference-index.ts`) is already on the
  context and unused here.
- **No review gate for referenced duplicates.** In `automatic` keep mode,
  `buildFixDecisionState` (`src/fix/fix-decisions.ts`) takes
  `selection.automaticKeepPath` without ever showing the user that trashing a
  path breaks real inbound references. Only `always-ask` mode forces a choice.

## Goals

- Preserve the three-phase pipeline: name groups, size groups, and
  size-capped SHA-256 hashing below `ctx.duplicateHashMaxBytes`.
- Per-file hash-state tracking with exactly the roadmap's three states:
  `hash-confirmed`, `cap-exceeded`, `read-failed`. Every reported group carries
  its members' states in evidence.
- Evidence enrichment per finding: inbound reference counts and mtimes for
  every file in the group, aligned by index with `relatedPaths`.
- Automatic keep mode keeps the path with the **highest inbound reference
  count**; equal counts are broken by stable vault-relative path order
  (lexicographically smallest wins).
- When **two or more** paths in a hash-confirmed group have inbound references,
  the fix action is marked `requiresReview`: `automatic` mode may propose a
  keep path but the user must make an explicit per-group choice before anything
  is trashed. The confirmation modal shows the impact (which paths are
  referenced, and that references are never rewritten).
- References are never rewritten: the only fix kind remains `trash-file`.
  After a trash, any dangling links surface on the next scan via the
  broken-links scanner.
- Fingerprints stay byte-identical to today; `COMPARISON_VERSION` stays `1`.

## Non-goals (this PR)

- No change to which groups exist or how they hash — phases 1–3 semantics,
  `duplicateHashMaxBytes`, and the empty-file/ignored-folder filters are
  untouched.
- No new fix-action kinds, no reference rewriting, no Milestone 2.1
  eligibility/impact policy types (this PR's gate is the duplicate-specific
  review requirement the roadmap assigns to Task 1.3; the general policy
  framework lands in Milestone 2).
- No settings changes, no CLI changes. CLI JSON inherits the new evidence and
  selection fields verbatim (additive).
- No empty-note, broken-link, or external-link work (Tasks 1.4–1.6).

## Design

### Hash-state tracking (scanner phase 3)

Phase 3 currently loses information on two paths: the `catch { continue }` for
read failures and the implicit skip of above-cap files. It becomes:

```ts
type HashState = "hash-confirmed" | "cap-exceeded" | "read-failed";

const hashGroups = new Map<string, string[]>();
const hashStates = new Map<string, HashState>();
for (const file of candidates) {
	if (file.stat.size > ctx.duplicateHashMaxBytes) {
		hashStates.set(file.path, "cap-exceeded");
		continue;
	}
	try {
		const content = await ctx.vault.readBinary(file);
		const hash = await hashContent(content);
		hashStates.set(file.path, "hash-confirmed");
		// ... group by hash as today
	} catch {
		hashStates.set(file.path, "read-failed");
	}
}
```

State semantics (documented once, used everywhere):

| State | Meaning for one file |
|---|---|
| `hash-confirmed` | SHA-256 was computed. On the warning finding this means byte-identical to the group; on a candidate finding it means the hash was compared and NO identical copy exists. |
| `cap-exceeded` | File size is above `duplicateHashMaxBytes`; content identity is unknown. |
| `read-failed` | `vault.readBinary` threw; content identity is unknown. |

The roadmap's wording ("evidence identifying hash-confirmed, cap-exceeded, and
read-failed states") maps to: the warning finding carries
`hashState: "hash-confirmed"` (all members hashed and identical); each
candidate finding carries `hashStates`, the sorted unique comma-joined states
of its member files, so `cap-exceeded` and `read-failed` are always visible
when they occur.

### Evidence shape

`Issue.evidence` is `Record<string, string | number | boolean>` — no arrays,
no nested objects. Per-file values are encoded as comma-joined strings aligned
**by index** with the finding's `relatedPaths` array (which the scanner
emits sorted). Consumers that need the per-file breakdown should zip against
`relatedPaths`, not split the joined `paths` string (paths may contain
commas/spaces).

Hash-confirmed (warning) finding:

| Field | Type | Meaning |
|---|---|---|
| `count` | number | group size (unchanged) |
| `paths` | string | comma-joined sorted paths (unchanged) |
| `hashState` | string | always `"hash-confirmed"` |
| `referenceCounts` | string | inbound reference counts per path, aligned with `relatedPaths` (e.g. `"0,3,1"`) |
| `mtimes` | string | `file.stat.mtime` epoch ms per path, aligned with `relatedPaths` (e.g. `"1000,2000,1000"`) |
| `referencedPaths` | string | paths with inbound reference count > 0, comma-joined (empty string when none) |

Candidate (info) findings (same-name and same-size) gain:

| Field | Type | Meaning |
|---|---|---|
| `hashStates` | string | sorted unique member states, comma-joined (e.g. `"cap-exceeded"`, `"hash-confirmed"`, `"read-failed"`) |
| `referenceCounts` | string | as above, aligned with the now-sorted `relatedPaths` |
| `mtimes` | string | as above |

Candidate `relatedPaths` become explicitly sorted (fingerprints already sorted
them; this only makes display/evidence order deterministic to match the
aligned fields). The precision inventory is unaffected: it sorts paths itself
and does not include evidence.

The roadmap's "last modification times" is named `mtimes` (plural, joined)
deliberately: singular `lastModified` is an established scalar epoch-ms field
elsewhere (orphan attachments), and reusing it for a joined string would
mislead `getNumber` consumers in the report renderers.

### Automatic keep algorithm

```ts
function pickAutomaticKeepPath(paths: string[], index: ReferenceIndex): string {
	let best = paths[0];
	let bestCount = getInboundReference(index, best)?.count ?? 0;
	for (const path of paths.slice(1)) {
		const count = getInboundReference(index, path)?.count ?? 0;
		if (count > bestCount || (count === bestCount && path < best)) {
			best = path;
			bestCount = count;
		}
	}
	return best;
}
```

Highest inbound reference count wins; ties break to the lexicographically
smallest vault-relative path. For all-unreferenced groups (the common case,
and the precision fixture's `duplicates/backup/fixture-data.bin` pair) the
result is identical to today's `sorted[0]`, so existing behavior and the
precision suite's keep assertion are preserved.

### Review gating (`requiresReview`)

`KeepOneSelection` (`src/scanner/Issue.ts`) gains two **optional** additive
fields:

```ts
export type KeepOneSelection = {
	kind: "keep-one";
	candidatePaths: string[];
	automaticKeepPath: string;
	referencedPaths?: string[]; // paths with inbound references (sorted)
	requiresReview?: boolean;   // true when 2+ paths have inbound references
};
```

Optional (not required) on purpose: `src/tests/main.test.ts` constructs
selection literals outside this task's file list, and older serialized issues
remain structurally valid. Consumers treat missing as `[]` / `false`.

Enforcement is split exactly along the existing seams:

- **Scanner** computes `requiresReview = referencedPaths.length >= 2` and, for
  such groups, changes `explanation.nextStep` to name the impact: "Several
  copies are referenced from notes. Review which location to keep before
  moving any copy to trash."
- **`buildFixDecisionState`** (`src/fix/fix-decisions.ts`): when
  `selection.requiresReview` is true, `automatic` mode no longer auto-takes
  `automaticKeepPath` — it requires `selectedKeeps.get(fingerprint)` exactly
  like `always-ask` mode, and the state stays incomplete (Confirm disabled)
  until the user chooses. A single referenced path does NOT trigger the gate:
  keeping the referenced copy is provably the least-breaking choice.
- **`getFreshFixAction`** additionally rejects when `requiresReview` changed
  between the requested and fresh actions, so a preflight re-scan that newly
  discovers references invalidates a stale batch decision.
- **`ConfirmFixModal`** (`src/fix/confirm-modal.ts`) renders the keep-choice
  radio group whenever a new pure helper
  `shouldAskForKeep(mode, selection) → mode === "always-ask" || selection.requiresReview === true`
  says so, and for review groups shows an impact line before the radios:
  `"<N> of <M> files are referenced by notes: <paths>. Choose which location
  to keep — references are never rewritten."` The existing
  `confirmBtn.disabled = !state.complete` is the hard gate; the modal only
  ever mutates through decisions produced by a complete state.
- **No reference rewriting**: no `remove-link-text` or new fix kinds are
  introduced for duplicates; `resolveDecisionAction` still only filters
  `targetPaths`.

### Fingerprints and COMPARISON_VERSION

All three fingerprint inputs stay byte-identical to today:
`{ paths: sorted.join(",") }` for hash groups, `{ nameCandidates: sorted }`,
`{ sizeCandidates: sorted }` for candidates. Evidence enrichment never enters
fingerprints (same principle as the orphan PR), so ignored findings stay
ignored and repeat-scan diffs stay empty for unchanged vaults.

`automaticKeepPath` (and therefore `fixAction.description`/`targetPaths`) may
change for users whose referenced duplicate was not the lexicographically
first path — that is a fix-policy change, not a detection-identity change:
the same group with the same members produces the same fingerprint. Per the
roadmap rule ("increment `COMPARISON_VERSION` when new detection semantics
would make old snapshots misleading"), old snapshots are NOT misleading —
group membership and confirmation semantics are unchanged — so
`COMPARISON_VERSION` stays `1` (`src/snapshot/scan-snapshot.ts`).

### Render/export impact

- `src/report/render-issues.ts` — **no change**. The duplicate branch reads
  `evidence.count` and `getEvidencePaths(issue)`; new evidence fields render
  through the generic `renderFindingEvidence` disclosure, and nothing pins the
  old candidate path order.
- `src/report/markdown-export.ts` — **no change**. `getMarkdownDetails` for
  duplicates reads `count`, `size`, and `getEvidencePaths`; the joined
  alignment fields stay in the evidence disclosure and CLI JSON rather than
  being duplicated as prose rows (same decision as the orphan PR: no added
  decision value in prose, noise for large groups).
- CLI JSON inherits evidence and the extended `fixAction.selection`
  additively; no stable field is renamed or removed.

## Test strategy

- `src/tests/duplicate-files.test.ts` — rewritten `makeCtx` seeds
  `referenceIndex`; new/updated cases: enriched hash-confirmed evidence and
  selection (`hashState`, aligned `referenceCounts`/`mtimes`,
  `referencedPaths`); keep = highest reference count; tie broken by path
  order; `requiresReview` when 2+ referenced; read failures degrade to
  candidates with `hashStates: "read-failed"` and no warning; above-cap
  candidates carry `hashStates: "cap-exceeded"`; existing negative cases
  (unique, empty, ignored) unchanged.
- `src/tests/fix-decisions.test.ts` — `makeDuplicateIssue` gains
  `referencedPaths`/`requiresReview`; new cases: automatic mode requires an
  explicit keep when `requiresReview` (incomplete without a selection,
  complete with one); `getFreshFixAction` rejects a `requiresReview` change.
- `src/tests/confirm-modal.test.ts` — new `shouldAskForKeep` truth table
  (automatic + review, automatic + no review, always-ask); a gating preview
  test proving a review group in automatic mode resolves only after an
  explicit keep choice.
- `src/tests/scanner-precision.test.ts` — **untouched**. The fixture's
  duplicate pair is unreferenced, so the automatic keep stays
  `duplicates/backup/fixture-data.bin` (tie → lexicographic), evidence is not
  part of the inventory, and the 18-line inventory is unchanged.
- `src/tests/main.test.ts` — untouched: the new selection fields are optional,
  so its literals still type-check and behave as before.

## Verification strategy

```bash
npm test -- src/tests/duplicate-files.test.ts src/tests/fix-decisions.test.ts src/tests/confirm-modal.test.ts
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: only hash-identical groups are confirmed duplicates (read failures
and above-cap files can never produce warnings), keep selection is
deterministic (reference count, then path order), and referenced duplicate
groups cannot be trashed without an explicit per-group keep choice in either
mode. Full gates green; precision inventory remains 18 lines.

## Risks

- **Automatic keep flips for referenced groups**: users who relied on
  "keep first path" will see a different (safer) proposal. Intended; the
  fingerprint is unchanged so nothing is re-flagged as new/resolved.
- **`automatic` mode now asks for review groups**: a batch containing a
  multi-referenced duplicate group cannot be confirmed in one click until the
  user picks a keep path. Intended per the roadmap ("require explicit review
  before trashing any path"); single-referenced and unreferenced groups keep
  the one-click flow.
- **Selection type widening**: `referencedPaths`/`requiresReview` are optional
  so every out-of-scope constructor (main.test fixtures, older serialized
  data) compiles and defaults to today's behavior.
