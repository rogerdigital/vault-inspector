# Vault Inspector CLI

The CLI is an optional, read-only companion for local automation and CI,
including generated and agent-managed vaults. It runs the same scanner logic
as the Obsidian plugin in a separate runtime: the plugin uses Obsidian
metadata and UI actions, while the CLI uses a local filesystem adapter for
terminal, CI, and automation workflows.

## Installation

Run it without a global install:

```bash
npx vault-inspector /path/to/your/vault
```

Or install it globally:

```bash
npm install -g vault-inspector
vinspect /path/to/your/vault
```

### Agent Skill

Vault Inspector includes a read-only Agent Skill for CLI-based vault checks:

```bash
gh skill install rogerdigital/vault-inspector vault-inspector
```

It can also be installed with the skills CLI:

```bash
npx skills add rogerdigital/vault-inspector --skill vault-inspector
```

The skill teaches agents to run scans, interpret JSON/Markdown output, use
baselines, and avoid modifying vault files.

## Quick start

Scan a vault:

```bash
vinspect /path/to/your/vault
```

From inside a vault, `.` means the current directory:

```bash
cd /path/to/your/vault
vinspect .
```

The full command also remains available:

```bash
vault-inspector /path/to/your/vault
```

Pin a specific npm version when repeatability matters — pin the version you
have reviewed and reuse it for baselines and scans:

```bash
npx vault-inspector@<version> /path/to/your/vault
```

`vault-inspector scan /path/to/vault` is also supported for scripts that prefer
an explicit subcommand.

## Commands and flags

Common options:

```bash
vinspect . --format markdown --output report.md
vinspect . --scanner broken-links,empty-notes
vinspect . --scanner external-links
vinspect . --progress
vinspect . --config vault-inspector.config.json
vinspect . --ignore-unresolved-note-links
```

`--progress` writes scanner progress to stderr so JSON and Markdown output on
stdout remain machine-readable.

For CI baseline checks:

```bash
vinspect . --baseline .vault-inspector-baseline.json --fail-on new
```

## Configuration

Config files are JSON and use the same option names:

```json
{
  "scanners": ["broken-links", "empty-notes", "large-files"],
  "severity": ["error", "warning"],
  "include": ["notes/**"],
  "exclude": ["templates/**"],
  "ignoredFolders": [".trash"],
  "ignoredFoldersByScanner": { "empty-notes": ["drafts"] },
  "ignoreUnresolvedNoteLinks": true,
  "failOn": "warning",
  "largeMarkdownBytes": 102400
}
```

CLI flags override config file values.

Set `ignoreUnresolvedNoteLinks` to `true`, or pass
`--ignore-unresolved-note-links`, when unresolved plain wikilinks such as
`[[Future Note]]` are intentional. The option does not hide embeds, missing
attachments, Markdown links, or missing headings in notes that exist. It is a
class-level ignore: unresolved path-like note wikilinks such as
`[[projects/Tpyed Name]]` are also hidden, so leave it disabled when those must
fail the scan.

Settings omitted from a config file fall back to the plugin defaults — for
example, `ignoredLargeMarkdownFrontmatterKeys` already defaults to
`["excalidraw-plugin"]`, so Excalidraw drawings are ignored without any config.
If your config lists the older `"excalidraw"` key, update it to
`"excalidraw-plugin"`.

`ignoredFoldersByScanner` maps scanner IDs to folders that are ignored for
that scanner only, on top of the global `ignoredFolders`. Omitted scanner
keys mean no per-scanner exclusions. Per-scanner folders are detection
inputs: changing them changes `comparison.scanProfile`, so baselines
recorded under different per-scanner folders are reported as not comparable
instead of producing misleading new/resolved counts.

## Output formats

The default output format is JSON. It includes summary counts, scanners run,
issues, ignored issues, fingerprints, classification, explanation, evidence, and
available fix-action metadata so other tools can decide what to do next. See
[JSON protocol](#json-protocol) for the stable automation contract.

Use `--format markdown --output report.md` for a human-readable report. JSON and
Markdown output stay on stdout; with `--progress`, scanner progress goes to
stderr so piped output remains machine-readable.

## JSON protocol

JSON output has a stable top-level protocol for automation:

- `schemaVersion` — currently `1`
- `tool` — always `vault-inspector`
- `toolVersion` — package version
- `summary` — stable counts and scanner metadata, including the issue count in `summary.issues`
- `issues` / `ignoredIssues` — issue records with stable `scannerId`, `severity`, `classification`, `explanation`, `primaryPath`, `relatedPaths`, `evidence`, `fingerprint`, and `fixAction` fields
- `comparison.fingerprints` — sorted, unique, complete unfiltered fingerprint set used as the baseline identity when the report is reused with `--baseline`
- `generatedAt`, `durationMs`, titles, and messages are informational and should not be used as stable identifiers

`classification` and `explanation` are additive stable fields. Existing stable
fields have not been removed or renamed.

## Baseline comparison

Baseline comparison uses issue `fingerprint` values from a previous JSON
report. When `--baseline` is provided, each issue includes `isNew`, and
`summary.newIssues` counts issues not found in the baseline. The top-level
`comparison` object describes whether the lifecycle counts are trustworthy:

- `available` — gate on this field. When `false`, the new/persisting/resolved
  counts are zeroed and must not be reported as lifecycle results.
- `mode` — `"profile"` for baselines carrying scan-profile metadata,
  `"legacy"` for older fingerprint-only baselines, `"none"` when no
  `--baseline` was given.
- `reason` — present when `available` is `false`: `missing-baseline`,
  `settings-changed` (the baseline was recorded under different detection
  settings, including `ignoredFoldersByScanner`), or `semantics-changed`
  (the baseline predates current comparison semantics).
- `newIssues`, `persistingIssues`, `resolvedIssues` — lifecycle counts over
  the full unfiltered result when `available` is `true`.
- `fingerprints` — the sorted, unique, complete identity set of the scan:
  every fingerprint from the full unfiltered result (`issues` +
  `ignoredIssues`). Output filters such as `--severity`, `--include`, and
  `--exclude` may shrink the visible `issues` and `ignoredIssues` arrays
  for presentation, but those filtered arrays do not define baseline
  completeness — only `comparison.fingerprints` does. Note that `--scanner`
  is not an output filter: it defines the detection scope (which scanners
  run, recorded in the scan profile), so findings from excluded scanners are
  absent from the scan result entirely, not merely hidden.

When a report is saved and reused as `--baseline`, the CLI reads the
baseline identity from its `comparison.fingerprints` field, so findings
hidden by output filters are still correctly classified as persisting or
resolved. Profile-aware reports created before `comparison.fingerprints`
existed are incomplete baselines: supplying one as `--baseline` exits with
code `2` (no stdout) and asks you to regenerate the baseline with the
current Vault Inspector version. The CLI never falls back to reconstructing
the identity set from filtered visible arrays.

A current-format baseline whose profile or comparison semantics no longer
match is a setup failure: the CLI exits with code `2` (overriding
`--fail-on`, including `none`), omits `isNew` from every issue, and prints a
stderr message naming the reason. Regenerate the baseline or rerun without
`--baseline`. Legacy baselines without comparison metadata still compare
fingerprint-only with a stderr warning recommending regeneration.

CLI baseline comparison is separate from the Obsidian plugin lifecycle. CLI
output does not include plugin scan snapshots or the plugin's
resolved-history view.

## Exit codes

- `0` — scan completed and did not match the configured `--fail-on` threshold.
- `1` — scan completed and matched the configured `--fail-on` threshold.
- `2` — invalid CLI usage, scan setup failure, or a `--baseline` file that is
  not comparable (`settings-changed` / `semantics-changed`).

`--fail-on` accepts `any` (default), `warning`, `error`, `new`, and `none`.

## Network access

The CLI makes no network requests unless the External Links scanner is
enabled. That scanner is disabled by default because it makes network
requests and depends on external sites, DNS, and rate limits. When enabled
with `--scanner external-links`, it checks URLs you explicitly have in your
notes — Markdown links, frontmatter links, images/embeds, and bare
HTTP/HTTPS URLs in note bodies — using HTTP HEAD requests through the
runtime `fetch` API.

External link checks are opt-in and network-dependent; timeouts or blocked
requests do not necessarily mean a URL is dead. `warning` is reported for
HTTP status 400 or higher, `info` for timed out, failed, or skipped URL
checks.

## Package boundary

CLI scan mode is read-only. `--fix` is reserved for a future explicit opt-in
fix command and currently exits with an error instead of modifying files.

The Obsidian Community Plugin release assets contain only the in-app plugin
files. The npm package additionally includes `cli.js` and exposes the
`vault-inspector` and `vinspect` commands. Starting with `0.4.10`, the npm
package is the supported CLI distribution path again.
