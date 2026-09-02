---
name: vault-inspector
description: Use when an agent needs to run read-only Vault Inspector CLI checks on an Obsidian vault, interpret JSON or Markdown scan results, compare baselines, or summarize vault maintenance issues without modifying vault files.
license: MIT
---

# Vault Inspector

Use Vault Inspector as a read-only quality gate for Obsidian vault maintenance. The skill is for terminal, CI, and agent-managed vault workflows that need to find broken links, orphan attachments, empty notes, external links, duplicate files, frontmatter type drift, tag usage issues, and large files.

## Safety Rules

- Treat the CLI as read-only. Do not modify, move, delete, or rewrite vault files as part of this skill.
- Do not present `--fix` as available. The CLI currently exits with an error for fix execution.
- Do not automatically delete orphan attachments, duplicate candidates, or large files. Summarize evidence and recommend manual review.
- Do not treat `title`, `message`, `generatedAt`, or `durationMs` as stable automation identifiers.
- Use stable fields for automation: `schemaVersion`, `toolVersion`, `summary`, `scannerId`, `severity`, `classification`, `explanation`, `primaryPath`, `relatedPaths`, `evidence`, `fingerprint`, `fixAction`, `isNew`, `summary.newIssues`, and the top-level `comparison` object (`available`, `mode`, `reason`, `newIssues`, `persistingIssues`, `resolvedIssues`, `fingerprints`).
- Gate baseline interpretation on `comparison.available`. Use `mode` and `reason` for diagnosis, never as pass/fail signals.
- Keep scan progress on stderr with `--progress`; keep stdout machine-readable.

## When To Run

Run Vault Inspector:

- before reorganizing, publishing, exporting, or archiving a vault;
- after generated or agent-managed note changes;
- before and after bulk edits to links, tags, frontmatter, or attachments;
- in CI when a vault or generated docs repository needs regression checks;
- when a user asks for vault hygiene, broken-link, orphan-file, duplicate-file, or large-file analysis.

## Basic Commands

From inside a vault:

```bash
vinspect . --format json
```

For one-off use without global install:

```bash
npx vault-inspector /path/to/vault --format json
```

Write a human-readable report:

```bash
vinspect . --format markdown --output report.md
```

Run selected scanners:

```bash
vinspect . --scanner broken-links,empty-notes,large-files --format json
```

Run the opt-in external link scanner only when network checks are acceptable:

```bash
vinspect . --scanner external-links --format json
```

Show progress without corrupting stdout:

```bash
vinspect . --format json --progress
```

## Baseline Workflow

Create a baseline:

```bash
vinspect . --format json --output .vault-inspector-baseline.json --fail-on none
```

Fail only on new findings:

```bash
vinspect . --baseline .vault-inspector-baseline.json --fail-on new --format json
```

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

When saving a scan report for later reuse as a baseline, preserve the
`comparison.fingerprints` field unchanged: it is the sorted, unique, complete
identity set of the unfiltered scan and the field the CLI reads as the
baseline identity. Never rebuild or substitute a current report's identity
from its filtered visible `issues`/`ignoredIssues` arrays — output filters
(`--scanner`, `--severity`, `--include`, `--exclude`) may hide findings that
are still part of the baseline. A profile-aware baseline without a complete
fingerprint set (created by an older CLI version) is rejected with exit code
`2` and empty stdout; regenerate it with a fresh scan using the current
Vault Inspector version.

CLI `isNew` is a baseline annotation and is separate from the Obsidian
plugin's scan lifecycle. The CLI does not output plugin snapshots or
resolved-history rows.

## Exit Codes

- `0`: scan completed and did not match the configured `--fail-on` threshold.
- `1`: scan completed and matched the configured `--fail-on` threshold.
- `2`: invalid CLI usage or scan setup failure.

If exit code is `2`, report the CLI error and do not interpret stdout as a successful scan result.

## Result Interpretation

Prioritize findings first by severity, then by classification:

1. Severity: `error`, then `warning`, then `info`.
2. Within the same severity: `confirmed`, then `candidate`, then `unverified`.

Interpret the presentation fields independently:

- `classification` describes the scanner's confidence: `confirmed`, `candidate`, or `unverified`.
- `explanation.why` states why the scanner reported the finding.
- `explanation.caveat`, when present, states a limitation or alternative interpretation. A missing caveat must not be used to upgrade a `candidate` finding to `confirmed`.
- `explanation.nextStep` states the recommended follow-up.
- `evidence` contains the raw machine-readable facts behind the explanation.

For each summary, include:

- total issue count;
- counts by severity;
- scanners run;
- findings ordered by severity and then classification;
- the explanation's why and next step, plus any caveat that affects interpretation;
- file paths and evidence needed for manual review;
- baseline new issue counts when available.

Avoid overstating certainty. Orphan attachments and duplicate candidates can be false positives when files are referenced by CSS, Canvas, Dataview, publishing pipelines, or external tools.

## Suggested Agent Response

Use this shape when reporting scan results:

```markdown
Vault Inspector found <N> issue(s): <E> error(s), <W> warning(s), <I> info.

Highest-priority findings:
- [<severity>/<classification>] <scannerId>: <primaryPath> - <explanation.why>
  - Caveat: <explanation.caveat, when present>
  - Next step: <explanation.nextStep>

Notes:
- <baseline/new issue note if relevant>
- <manual review caveat for orphan/duplicate candidates if relevant>
```

If the scan passes, state the command run and the relevant zero counts. Do not claim the vault is perfect; say that Vault Inspector found no issues matching the selected scanners and filters.
