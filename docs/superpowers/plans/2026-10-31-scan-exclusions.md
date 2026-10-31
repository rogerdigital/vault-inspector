# Unified scan exclusions

Approved behavior: folder and tag rules share one settings list. Each rule has a condition, value, and scope (`all` or a list of scanner IDs). Rules are additive. Tags match frontmatter and inline tags, including descendants at slash boundaries. Excluded notes remain in the full reference and destination indexes; attachments are not transitively excluded.

Legacy folder settings remain readable and editable through the unified list. Existing folder actions retain their scanner scope. Statistical checks use participating files and describe their scope accurately. Rule changes invalidate comparison profiles. CLI supports the same rules. Reports expose excluded file counts by scanner, separately from ignored findings.

- [x] Add normalized rule model, legacy compatibility, and behavior tests.
- [x] Apply rule matching to scanner subjects while retaining complete reference indexes; integrate profile identity and exclusion counts.
- [x] Replace separate folder controls with a unified editor; preserve contextual actions.
- [x] Integrate CLI configuration, validation, output, and tag parsing checks.
- [x] Verify boundary cases, references, statistics, baseline changes, and settings recovery.
- [x] Update user documentation and run lint, Obsidian warnings, build, tests, and packaging dry run.

Validation prioritizes actual scanner behavior and local-vault integration. Desktop visual acceptance will be reported separately if no live Obsidian session is available.

## Review and validation

- Full verification passed: lint, Obsidian warning lint, production build, 64 test files / 1002 tests, npm packaging dry run, and diff whitespace checks.
- Regression coverage includes frontmatter/inline and nested tag exclusions, case normalization, scope isolation, legacy conversion, baseline identity, reference preservation, CLI validation and built-bundle execution, and UI save-failure recovery.
- Independent review found exclusion counts included non-subject files; counts now use each scanner's subject universe, with regression coverage.
- Initial verification covered unit tests and type/lint checks; native desktop acceptance is recorded below. Scan profiles from older versions can require a one-time baseline reset.

## Native desktop acceptance

Verified in Obsidian 1.14.5 using `/Users/Roger/my-vault`; MainVault content and settings were not modified and no scans ran there.

- Baseline: 4 broken links, 41 orphan attachments, 7 tag findings (including 3 isolated fixture notes).
- Tag exclusion limited to Broken Links: 2 broken links, 41 orphan attachments, 7 tag findings.
- Tag exclusion for all scanners: 2 broken links, 41 orphan attachments, 5 tag findings; attachment exclusions correctly counted as 0.
- Rule removal: baseline counts restored. Prefix matching, descendant/frontmatter/inline/case matching, heading targets, attachment references, empty validation, editing, persistence through plugin reload, and close/reopen behavior passed.
- Desktop testing found and fixed two issues: Obsidian layout CSS overriding native hidden attributes; cached native settings definitions holding stale rule lists. The editor now has scoped visibility CSS and a stable render-time definition with local refresh. Added a regression test for cached-definition reuse.
- Restored the complete pre-test plugin data backup byte-for-byte and removed only the four created fixture files. Final checks: lint, warning lint, build, 64 test files / 1003 tests, packaging dry run, and whitespace checks passed.
