# Ignore Unresolved Note Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in CLI/config policy that suppresses deliberate unresolved plain note wikilinks while preserving broken embeds, attachment targets, Markdown links, and missing headings.

**Architecture:** Add one default-off detection setting, `ignoreUnresolvedNoteLinks`, to the shared settings and scan context so the broken-links scanner makes the decision before issues, fingerprints, baselines, summaries, and exit codes are produced. Preserve reference origin while collecting broken-link candidates and suppress a missing note only when every matching reference is a non-embed wikilink; unknown reference forms remain reportable. Expose the policy as the flat config key `ignoreUnresolvedNoteLinks` and CLI flag `--ignore-unresolved-note-links`, following the repository's existing flat CLI configuration style.

**Tech Stack:** TypeScript, Obsidian metadata cache, Node.js CLI, Vitest, ESLint, esbuild.

---

## Scope and behavior contract

- Default behavior remains unchanged: unresolved note links are still `error` + `confirmed`.
- With `ignoreUnresolvedNoteLinks: true`, `[[Future Note]]` and `[[Future Note|Alias]]` are omitted when the note target does not exist.
- `![[Missing Note]]`, `![[missing.png]]`, `[Missing](missing.md)`, and missing headings in an existing note remain findings.
- If the scanner cannot recover the original reference syntax from the metadata cache, it keeps the finding instead of risking a false negative.
- If the same source file references one missing target as both an ignorable plain wikilink and a non-ignorable embed or Markdown link, one finding remains.
- Retained findings keep their existing severity, classification, explanation, evidence, fingerprint, and fix-action behavior.
- The option intentionally suppresses unresolved path-like note wikilinks such as `[[folder/Typo]]`. This trade-off must be documented because Option 1 cannot distinguish a deliberate future note from a typo reliably.
- No glob allowlist, generic classification filter, settings-tab UI, JSON schema change, version bump, or release workflow change is included.

## Work estimate

- Shared setting, scan-profile propagation, candidate semantics, and focused scanner tests: 2.5–4 hours.
- CLI flag/config parsing, validation, integration tests, and built bundles: 1.5–2 hours.
- Documentation, full verification, diff review, and delivery notes: 1–2 hours.
- Total: 5–8 hours, normally one focused engineering day. Risk is low-to-medium; the main risk is preserving link/embed origin through deduplication without hiding a non-ignorable reference.

## File map

- Modify `src/settings/settings.ts`: define the default-off shared detection setting.
- Modify `src/scanner/ScanContext.ts`: make the setting available to scanners.
- Modify `src/scanner/ScanRunner.ts`: propagate the setting into each scan context.
- Modify `src/scanner/scan-profile.ts`: include the detection-changing setting in lifecycle compatibility profiles.
- Modify `src/scanner/scanners/broken-links.ts`: retain reference kind during candidate collection and suppress only eligible unresolved notes.
- Modify `src/tests/helpers/scan-context.ts`: provide the default in shared scanner test contexts.
- Modify `src/tests/broken-links.test.ts`: cover default, opt-in, preserved finding classes, unknown syntax, and mixed references.
- Modify `src/tests/scan-runner.test.ts`: prove settings propagation.
- Modify `src/tests/scan-profile.test.ts`: prove lifecycle profiles change with the detection policy.
- Modify `cli/cli.ts`: parse, validate, merge, document, and pass through the flag/config value.
- Modify `src/tests/cli.test.ts`: cover flag behavior, config behavior, validation, exit codes, and retained finding classes.
- Modify `README.md`: document the option, config key, exact boundary, and path-typo trade-off.

---

## Execution prerequisite

- [ ] Confirm the starting state and create the feature branch:

```bash
git status --short --branch
git switch -c fix/ignore-unresolved-note-links
```

Expected: the branch starts from `main` at `0.5.1`; the pre-existing untracked `.zcode/` directory and this plan file remain untouched unless explicitly staged later.

---

### Task 1: Add the shared scan policy and scanner behavior

**Files:**
- Modify: `src/settings/settings.ts:6-55`
- Modify: `src/scanner/ScanContext.ts:4-26`
- Modify: `src/scanner/ScanRunner.ts:43-71`
- Modify: `src/scanner/scan-profile.ts:14-38`
- Modify: `src/scanner/scanners/broken-links.ts:12-175`
- Modify: `src/tests/helpers/scan-context.ts:43-78`
- Modify: `src/tests/broken-links.test.ts:6-292`
- Modify: `src/tests/scan-runner.test.ts:12-50`
- Modify: `src/tests/scan-profile.test.ts:101-132`

- [ ] **Step 1: Add failing scanner tests for the opt-in boundary**

Add these tests inside `describe("brokenLinksScanner", ...)` in `src/tests/broken-links.test.ts`:

```ts
	it("ignores unresolved plain note wikilinks when enabled", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Future Note|Someday",
						original: "[[Future Note|Someday]]",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { "Future Note|Someday": 1 },
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toEqual([]);
	});

	it("keeps non-plain-link failures when unresolved note links are ignored", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [
				{ path: "Source.md" },
				{ path: "Target.md" },
			],
			metadataByPath: {
				"Source.md": {
					links: [
						{
							link: "missing.md",
							original: "[Missing](missing.md)",
							position: {} as any,
						},
						{
							link: "Target#Missing",
							original: "[[Target#Missing]]",
							position: {} as any,
						},
					],
					embeds: [
						{
							link: "Missing Note",
							original: "![[Missing Note]]",
							position: {} as any,
						},
						{
							link: "assets/missing.png",
							original: "![[assets/missing.png]]",
							position: {} as any,
						},
					],
				},
				"Target.md": {
					headings: [{
						heading: "Existing",
						level: 1,
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": {
					"missing.md": 1,
					"Missing Note": 1,
					"assets/missing.png": 1,
				},
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(4);
		expect(issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
			"Linked file not found: missing.md",
			'Heading "#Missing" not found in Target.md',
			"Linked file not found: Missing Note",
			"Attachment not found: assets/missing.png",
		]));
	});

	it("keeps unresolved targets whose original reference syntax is unavailable", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			unresolvedLinks: {
				"Source.md": { Unknown: 1 },
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toBe("Linked file not found: Unknown");
	});

	it("keeps a target referenced by both a plain wikilink and an embed", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Missing",
						original: "[[Missing]]",
						position: {} as any,
					}],
					embeds: [{
						link: "Missing",
						original: "![[Missing]]",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { Missing: 2 },
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toBe("Linked file not found: Missing");
	});
```

- [ ] **Step 2: Add failing propagation and scan-profile tests**

Add this test to `src/tests/scan-runner.test.ts`:

```ts
	it("passes the unresolved-note policy into scanner contexts", async () => {
		let observed: boolean | undefined;
		const runner = new ScanRunner();
		runner.register({
			id: "broken-links",
			scan: (ctx: ScanContext) => {
				observed = ctx.ignoreUnresolvedNoteLinks;
				return [];
			},
		});
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.ignoreUnresolvedNoteLinks = true;

		await runner.run(makeApp(), settings);

		expect(observed).toBe(true);
	});
```

Add this row to the `it.each` table in `src/tests/scan-profile.test.ts`:

```ts
		["unresolved note link policy", (settings: InspectorSettings) => {
			settings.ignoreUnresolvedNoteLinks = true;
		}],
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npm test -- src/tests/broken-links.test.ts src/tests/scan-runner.test.ts src/tests/scan-profile.test.ts
```

Expected: FAIL with missing `ignoreUnresolvedNoteLinks` properties and the unresolved plain wikilink still reported.

- [ ] **Step 4: Add the shared detection setting and propagation**

Add this property immediately after `ignoredFoldersByScanner` in `InspectorSettings`:

```ts
	ignoreUnresolvedNoteLinks: boolean;
```

Add this default immediately after `ignoredFoldersByScanner` in `DEFAULT_SETTINGS`:

```ts
	ignoreUnresolvedNoteLinks: false,
```

Add the field to `ScanContext` in `src/scanner/ScanContext.ts`:

```ts
	ignoredFolders: string[];
	ignoreUnresolvedNoteLinks: boolean;
	ignoredProperties: string[];
```

Propagate it in the base context in `src/scanner/ScanRunner.ts`:

```ts
			ignoredFolders: settings.ignoredFolders,
			ignoreUnresolvedNoteLinks: settings.ignoreUnresolvedNoteLinks,
			ignoredProperties: settings.ignoredProperties,
```

Add it to the canonical object in `src/scanner/scan-profile.ts`:

```ts
		ignoredFoldersByScanner: Object.fromEntries(
			SCANNER_IDS.map((scannerId) => [
				scannerId,
				normalizeFolders(settings.ignoredFoldersByScanner[scannerId] ?? []),
			]),
		),
		ignoreUnresolvedNoteLinks: settings.ignoreUnresolvedNoteLinks,
		largeMarkdownBytes: settings.largeMarkdownBytes,
```

Add the default to `makeScanContext` in `src/tests/helpers/scan-context.ts` and the local `makeCtx` helper in `src/tests/broken-links.test.ts`:

```ts
		ignoredFolders: [],
		ignoreUnresolvedNoteLinks: false,
		ignoredProperties: [],
```

- [ ] **Step 5: Preserve link origin and implement conservative suppression**

In `src/scanner/scanners/broken-links.ts`, add these local types above `brokenLinksScanner`:

```ts
type LinkCandidate = {
	linkText: string;
	fixLinkText?: string;
	ignorableUnresolvedNote: boolean;
};

type LinkReference = {
	reference: {
		link: string;
		original?: string;
	};
	isEmbed: boolean;
};
```

Replace reference and candidate collection with:

```ts
			const references: LinkReference[] = [
				...(cache.links ?? []).map((reference) => ({
					reference,
					isEmbed: false,
				})),
				...(cache.embeds ?? []).map((reference) => ({
					reference,
					isEmbed: true,
				})),
			];
			const linkCandidates = new Map<string, LinkCandidate>();
			const addCandidate = (candidate: LinkCandidate) => {
				const existing = linkCandidates.get(candidate.linkText);
				linkCandidates.set(candidate.linkText, {
					linkText: candidate.linkText,
					fixLinkText: existing?.fixLinkText ?? candidate.fixLinkText,
					ignorableUnresolvedNote: existing
						? existing.ignorableUnresolvedNote && candidate.ignorableUnresolvedNote
						: candidate.ignorableUnresolvedNote,
				});
			};

			for (const unresolvedLink of Object.keys(linksForFile ?? {})) {
				const matchingReferences = references.filter(
					({ reference }) => reference.link === unresolvedLink,
				);
				if (matchingReferences.length === 0) {
					addCandidate({
						linkText: unresolvedLink,
						ignorableUnresolvedNote: false,
					});
					continue;
				}
				for (const reference of matchingReferences) {
					addCandidate(getLinkCandidate(reference));
				}
			}
			for (const reference of references) {
				if (reference.reference.link.includes("#")) {
					addCandidate(getLinkCandidate(reference));
				}
			}
```

Pass the candidate policy to `resolveLinkIssues`:

```ts
			for (const candidate of linkCandidates.values()) {
				issues.push(...resolveLinkIssues(
					ctx,
					file.path,
					candidate.linkText,
					candidate.fixLinkText,
					candidate.ignorableUnresolvedNote,
				));
			}
```

Replace `resolveLinkIssues` with this complete implementation, preserving existing retained-finding behavior:

```ts
function resolveLinkIssues(
	ctx: ScanContext,
	sourcePath: string,
	linkText: string,
	fixLinkText: string | undefined,
	ignorableUnresolvedNote: boolean,
): Issue[] {
	const issues: Issue[] = [];

	const rawTarget = getLinkTarget(linkText);

	if (!rawTarget || hasUriScheme(rawTarget)) return issues;

	// Attachment link (has a known non-md extension)
	if (isAttachmentLink(rawTarget)) {
		if (!findResolvedPath(ctx, rawTarget, sourcePath)) {
			issues.push(
				makeIssue(
					sourcePath,
					linkText,
					fixLinkText,
					rawTarget,
					"error",
					`Attachment not found: ${rawTarget}`,
				),
			);
		}
		return issues;
	}

	// Markdown or heading link
	const linkDestination = linkText.split("|")[0];
	const headingPart = linkDestination.includes("#")
		? linkDestination.split("#").slice(1).join("#")
		: null;

	const resolvedPath = findMarkdownPath(ctx, rawTarget, sourcePath);

	if (!resolvedPath) {
		if (ctx.ignoreUnresolvedNoteLinks && ignorableUnresolvedNote) {
			return issues;
		}
		issues.push(
			makeIssue(
				sourcePath,
				linkText,
				fixLinkText,
				rawTarget,
				"error",
				`Linked file not found: ${rawTarget}`,
			),
		);
		return issues;
	}

	if (headingPart) {
		const headingCache = ctx.metadataCache.getFileCache(
			ctx.markdownFiles.find((file) => file.path === resolvedPath)!,
		);
		const headings = headingCache?.headings ?? [];
		const headingSlug = slugifyHeading(headingPart);
		const found = headings.some(
			(heading) => slugifyHeading(heading.heading) === headingSlug,
		);
		if (!found) {
			issues.push(
				makeIssue(
					sourcePath,
					linkText,
					fixLinkText,
					resolvedPath,
					"warning",
					`Heading "#${headingPart}" not found in ${resolvedPath}`,
				),
			);
		}
	}

	return issues;
}
```

Replace `getLinkCandidate` with:

```ts
function getLinkCandidate({ reference, isEmbed }: LinkReference): LinkCandidate {
	const originalWikiLink = reference.original?.match(/^!?\[\[([\s\S]+)\]\]$/);
	if (originalWikiLink) {
		return {
			linkText: originalWikiLink[1],
			fixLinkText: originalWikiLink[1],
			ignorableUnresolvedNote:
				!isEmbed && reference.original?.startsWith("[[") === true,
		};
	}
	return {
		linkText: reference.link,
		ignorableUnresolvedNote: false,
	};
}
```

This uses logical AND while merging duplicate targets. Suppression therefore occurs only when every recovered reference for the source/target pair is an ordinary wikilink.

- [ ] **Step 6: Run focused tests and type/build checks to verify GREEN**

Run:

```bash
npm test -- src/tests/broken-links.test.ts src/tests/scan-runner.test.ts src/tests/scan-profile.test.ts
npm run build
git diff --check
```

Expected: all focused tests PASS; TypeScript/build and diff check exit 0.

- [ ] **Step 7: Commit the shared scanner policy**

```bash
git add src/settings/settings.ts src/scanner/ScanContext.ts src/scanner/ScanRunner.ts src/scanner/scan-profile.ts src/scanner/scanners/broken-links.ts src/tests/helpers/scan-context.ts src/tests/broken-links.test.ts src/tests/scan-runner.test.ts src/tests/scan-profile.test.ts main.js cli.js
git commit -m "fix: support intentional unresolved note links"
```

---

### Task 2: Expose the policy through CLI flags and config

**Files:**
- Modify: `cli/cli.ts:19-44,142-214,216-291,432-484`
- Modify: `src/tests/cli.test.ts:29-49,187-290,500-650`

- [ ] **Step 1: Add failing CLI flag and exit-code test**

Add this test to `src/tests/cli.test.ts`:

```ts
	it("ignores unresolved plain note wikilinks through a CLI flag", async () => {
		await withVault(
			{
				"Source.md": "[[Future Note]]\n",
			},
			async (vaultPath) => {
				const result = await runCli([
					vaultPath,
					"--scanner",
					"broken-links",
					"--ignore-unresolved-note-links",
				]);

				expect(result.exitCode).toBe(0);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(0);
				expect(payload.issues).toEqual([]);
			},
		);
	});
```

- [ ] **Step 2: Add failing config-boundary and validation tests**

Add these tests to `src/tests/cli.test.ts`:

```ts
	it("loads unresolved note filtering from config without hiding other broken links", async () => {
		await withVault(
			{
				"Source.md": [
					"[[Future Note]]",
					"![[Missing Note]]",
					"![[assets/missing.png]]",
					"[Missing](missing.md)",
					"[[Target#Missing]]",
				].join("\n"),
				"Target.md": "# Existing\n",
			},
			async (vaultPath) => {
				const configPath = join(vaultPath, "vault-inspector.config.json");
				await writeFile(
					configPath,
					JSON.stringify({
						scanners: ["broken-links"],
						ignoreUnresolvedNoteLinks: true,
					}),
					"utf8",
				);

				const result = await runCli([vaultPath, "--config", configPath]);

				expect(result.exitCode).toBe(1);
				const payload = JSON.parse(result.stdout);
				expect(payload.summary.issues).toBe(4);
				expect(payload.issues.map((issue: { message: string }) => issue.message))
					.toEqual(expect.arrayContaining([
						"Linked file not found: Missing Note",
						"Attachment not found: assets/missing.png",
						"Linked file not found: missing.md",
						'Heading "#Missing" not found in Target.md',
					]));
				expect(payload.issues).not.toContainEqual(
					expect.objectContaining({
						message: "Linked file not found: Future Note",
					}),
				);
			},
		);
	});

	it("rejects a non-boolean unresolved note config value", async () => {
		await withVault({ "Source.md": "[[Future Note]]\n" }, async (vaultPath) => {
			const configPath = join(vaultPath, "vault-inspector.config.json");
			await writeFile(
				configPath,
				JSON.stringify({ ignoreUnresolvedNoteLinks: "yes" }),
				"utf8",
			);

			const result = await runCli([vaultPath, "--config", configPath]);

			expect(result.exitCode).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toContain(
				"ignoreUnresolvedNoteLinks must be a boolean",
			);
		});
	});
```

Extend the existing help test with:

```ts
		expect(result.stdout).toContain("--ignore-unresolved-note-links");
```

- [ ] **Step 3: Run CLI tests and verify RED**

Run:

```bash
npm test -- src/tests/cli.test.ts
```

Expected: FAIL because the flag is unknown, config does not propagate the setting, and invalid config is not rejected.

- [ ] **Step 4: Parse and merge the CLI/config option**

Add the property to `CliOptions` in `cli/cli.ts`:

```ts
	ignoredFolders: string[];
	ignoreUnresolvedNoteLinks: boolean;
	baselinePath?: string;
```

Initialize it in `parseArgs`:

```ts
		ignoredFolders: [],
		ignoreUnresolvedNoteLinks: false,
		failOn: "any",
```

Handle the flag immediately after `--ignore-folder`:

```ts
		} else if (arg === "--ignore-unresolved-note-links") {
			options.ignoreUnresolvedNoteLinks = true;
```

Add the property to `CliConfig`'s `Pick` list:

```ts
		| "ignoredFolders"
		| "ignoreUnresolvedNoteLinks"
		| "baselinePath"
```

Merge config and flag values in `loadConfig`:

```ts
			ignoreUnresolvedNoteLinks:
				args.ignoreUnresolvedNoteLinks ||
				(config.ignoreUnresolvedNoteLinks ?? false),
```

Pass it through `makeSettings`:

```ts
		ignoredFolders: options.ignoredFolders,
		ignoreUnresolvedNoteLinks: options.ignoreUnresolvedNoteLinks,
		ignoredProperties: options.ignoredProperties ?? DEFAULT_SETTINGS.ignoredProperties,
```

- [ ] **Step 5: Validate config and document the flag in CLI help**

Add this validation to `validateConfig`:

```ts
	if (
		config.ignoreUnresolvedNoteLinks !== undefined &&
		typeof config.ignoreUnresolvedNoteLinks !== "boolean"
	) {
		return "ignoreUnresolvedNoteLinks must be a boolean";
	}
```

Add this line to `usageText()`:

```ts
  --ignore-unresolved-note-links
                            Ignore missing plain note wikilinks.
```

- [ ] **Step 6: Run CLI and scanner regression tests to verify GREEN**

Run:

```bash
npm test -- src/tests/cli.test.ts src/tests/broken-links.test.ts src/tests/scan-runner.test.ts src/tests/scan-profile.test.ts
npm run build
node cli.js --help
git diff --check
```

Expected: all focused tests PASS; build exits 0; built help contains `--ignore-unresolved-note-links`; diff check exits 0.

- [ ] **Step 7: Commit the CLI surface**

```bash
git add cli/cli.ts src/tests/cli.test.ts cli.js
git commit -m "feat: expose unresolved note link filtering in CLI"
```

`npm run build` regenerates the committed bundles; only `cli.js` should differ in this task because the shared scanner bundle was committed in Task 1. Confirm with `git status --short` that no other generated or unrelated files are staged.

---

### Task 3: Document the exact safety boundary

**Files:**
- Modify: `README.md:145-184`

- [ ] **Step 1: Add the flag to common CLI examples**

Add this line to the common options block in `README.md`:

```bash
vinspect . --ignore-unresolved-note-links
```

- [ ] **Step 2: Add the config key to the JSON example**

Update the config example to include:

```json
{
  "scanners": ["broken-links", "empty-notes", "large-files"],
  "severity": ["error", "warning"],
  "include": ["notes/**"],
  "exclude": ["templates/**"],
  "ignoredFolders": [".trash"],
  "ignoreUnresolvedNoteLinks": true,
  "failOn": "warning",
  "largeMarkdownBytes": 102400
}
```

- [ ] **Step 3: Document included, excluded, and risky cases**

Add this paragraph after the config precedence sentence:

```md
Set `ignoreUnresolvedNoteLinks` to `true`, or pass
`--ignore-unresolved-note-links`, when unresolved plain wikilinks such as
`[[Future Note]]` are intentional. The option does not hide embeds, missing
attachments, Markdown links, or missing headings in notes that exist. It is a
class-level ignore: unresolved path-like note wikilinks such as
`[[projects/Tpyed Name]]` are also hidden, so leave it disabled when those must
fail the scan.
```

- [ ] **Step 4: Check documentation and commit**

Run:

```bash
git diff --check
rg -n "ignoreUnresolvedNoteLinks|ignore-unresolved-note-links" README.md cli/cli.ts
```

Expected: diff check exits 0; both the config key and flag appear in README and CLI source.

Commit:

```bash
git add README.md
git commit -m "docs: explain unresolved note link filtering"
```

---

### Task 4: Run complete verification and inspect the shipped CLI boundary

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run the repository-required verification suite**

Run:

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm pack --dry-run
```

Expected: every command exits 0; all Vitest tests pass; npm pack includes `cli.js` and does not include source-only CLI files.

- [ ] **Step 2: Verify built help and package contents**

Run:

```bash
node cli.js --help
npm pack --dry-run
```

Expected: help lists `--ignore-unresolved-note-links`; the package still contains the expected `main.js`, `cli.js`, `manifest.json`, `styles.css`, `versions.json`, `README.md`, and `LICENSE` assets.

- [ ] **Step 3: Review the final diff for scope and compatibility**

Run:

```bash
git diff main...HEAD --stat
git diff main...HEAD -- src/settings/settings.ts src/scanner/ScanContext.ts src/scanner/ScanRunner.ts src/scanner/scan-profile.ts src/scanner/scanners/broken-links.ts cli/cli.ts README.md
git status --short
```

Expected:

- only files listed in this plan plus generated `main.js` and `cli.js` changed;
- default scanner behavior remains unchanged;
- no classification, fingerprint, schema version, settings-tab, manifest version, or workflow changes appear;
- the pre-existing untracked `.zcode/` directory remains untouched and unstaged.

- [ ] **Step 4: Prepare the delivery summary**

Report:

- the new flag and config key;
- the exact categories that remain reportable;
- the path-typo trade-off;
- focused and full verification commands with outcomes;
- the three logical commits created by this plan.
