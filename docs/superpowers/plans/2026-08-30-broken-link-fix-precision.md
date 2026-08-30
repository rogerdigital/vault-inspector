# Broken Link Fix Precision Implementation Plan (Milestone 1, Task 1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Removing a broken link preserves its readable text. `[[Missing|Readable label]]` becomes `Readable label`, `[[Missing]]` becomes `Missing`, `[Readable label](missing)` becomes `Readable label` (new fix availability for markdown links), and `![[missing.png]]` is removed entirely. Fix actions carry the exact source syntax (`original`) and replacement text (`replacement`) as additive `FixAction` fields; the executor matches the literal range instead of reconstructing a wiki pattern, keeps protecting fenced code / inline code / HTML comments, and never consumes an embed occurrence with a non-embed action. Evidence gains a `linkKind` scalar (`embed` / `attachment` / `markdown-link` / `heading` / `note-link`). Ambiguous merges (plain + aliased references to one target) withhold the fix action. `ignoreUnresolvedNoteLinks` semantics and fingerprints are unchanged.

**Architecture:** `getLinkCandidate` in the scanner derives `{ original, replacement }` from `LinkCache.original` (wiki, wiki-embed, markdown, markdown-embed shapes); the candidate merge keeps a fix only when all merged references share the same `original`. `FixAction` grows two optional fields (`original`, `replacement`); the executor's `remove-link-text` case prefers the literal replacement and falls back to the legacy `linkText` wiki pattern. No `ScanContext`, `ScanRunner`, settings, renderer, confirm-modal, or CLI changes — all consumers read `kind`/`label`/`description`/`targetPaths` generically and already handle absent `fixAction`.

**Tech Stack:** TypeScript, Vitest, `makeScanContext` fixtures

Design doc: `docs/superpowers/specs/2026-08-30-broken-link-fix-precision-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.5)

---

## Ground rules

- Branch: `fix/broken-link-precision`, cut from latest `main` (must include PR #125's `reference.link`-keyed candidates).
- One commit: `fix: preserve labels when removing broken links`.
- Fingerprints MUST stay byte-identical: `generateFingerprint("broken-links", sourcePath, { link, target })`. `linkKind`, fix fields, and the ambiguity guard never enter it; user ignore lists survive. `COMPARISON_VERSION` stays `1`.
- The precision fixture files (`src/tests/fixtures/precision-vault/**`) are the M0-frozen evidence base: DO NOT modify any fixture file. Only `src/tests/scanner-precision.test.ts` changes (assertions, not inventory — `EXPECTED_INVENTORY` stays 15 lines, byte-identical).
- `FixAction.original` / `FixAction.replacement` are additive optional fields; never rename or remove `linkText` (persisted snapshot fix decisions still execute through the legacy executor path).
- The fix action label stays exactly `"Remove link"` (renderers and unrelated suites treat it as opaque); only `description` varies.
- `ignoreUnresolvedNoteLinks` semantics are frozen: only plain non-embed wiki note links are ignorable; markdown links, attachments, headings, and embeds never are.
- Do not modify `src/scanner/ScanContext.ts`, `src/scanner/ScanRunner.ts`, `src/scanner/finding-presentation.ts`, `src/scanner/issue-fingerprint.ts`, `src/scanner/reference-index.ts`, `src/report/*`, `src/fix/confirm-modal.ts`, `src/snapshot/*`, `src/main.ts`, `src/settings/*`, or `cli/`.
- Full gates before commit: `npm run lint && npm run lint:obsidian-warnings && npm run build && npm test`.

---

### Task 1: Create the branch

- [ ] **Step 1: Branch from latest main**

```bash
git checkout main && git pull && git checkout -b fix/broken-link-precision
```

---

### Task 2: Update the scanner unit tests first (TDD)

**Files:**
- Modify: `src/tests/broken-links.test.ts` (full rewrite)

Two existing tests change behavior legitimately (markdown links gain a fix
action; plain+aliased merges withhold it) and one gains an assertion. Replace
the entire file with:

```typescript
import { describe, it, expect } from "vitest";
import { brokenLinksScanner } from "../scanner/scanners/broken-links";
import type { ScanContext } from "../scanner/ScanContext";
import { makeScanContext } from "./helpers/scan-context";

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["broken-links"]),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		watchedTags: [],
		ignoredFolders: [],
		ignoreUnresolvedNoteLinks: false,
		...overrides,
	} as ScanContext;
}

describe("brokenLinksScanner", () => {
	it("detects unresolved link to missing file", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "notes/missing": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("error");
		expect(issues[0].evidence.target).toBe("notes/missing");
		expect(issues[0]).toMatchObject({
			classification: "confirmed",
			explanation: {
				why: "The link target could not be resolved in the vault.",
				nextStep: "Correct the target or remove the link from the source note.",
			},
		});
	});

	it("does not report links that resolve to existing files", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "notes/b": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("detects broken heading link", async () => {
		const file = { path: "notes/a.md" } as any;
		const targetFile = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file, targetFile],
			allFiles: [file, targetFile],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			metadataCache: {
				getFileCache: (f: any) => {
					if (f.path === "notes/b.md") {
						return { headings: [{ heading: "Other Heading" }] };
					}
					return {};
				},
				unresolvedLinks: {
					"notes/a.md": { "notes/b#Missing Heading": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("warning");
		expect(issues[0].message).toContain("Heading");
		expect(issues[0]).toMatchObject({
			classification: "confirmed",
			explanation: {
				why: "The target note exists, but the referenced heading was not found.",
				nextStep: "Correct the heading reference or remove it from the source note.",
			},
		});
	});

	it("does not report valid heading links", async () => {
		const file = { path: "notes/a.md" } as any;
		const targetFile = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file, targetFile],
			allFiles: [file, targetFile],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			metadataCache: {
				getFileCache: (f: any) => {
					if (f.path === "notes/b.md") {
						return { headings: [{ heading: "My Heading" }] };
					}
					return {};
				},
				unresolvedLinks: {
					"notes/a.md": { "notes/b#My Heading": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("detects missing non-English headings without collapsing them", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [
				{ path: "notes/source.md" },
				{ path: "notes/目标.md" },
			],
			metadataByPath: {
				"notes/source.md": {},
				"notes/目标.md": {
					headings: [{ heading: "项目计划", level: 2, position: {} as any }],
				},
			},
			unresolvedLinks: {
				"notes/source.md": {
					"目标#不存在": 1,
				},
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0]).toEqual(expect.objectContaining({
			severity: "warning",
			primaryPath: "notes/source.md",
			relatedPaths: ["notes/目标.md"],
			evidence: expect.objectContaining({
				link: "目标#不存在",
				target: "notes/目标.md",
			}),
		}));
	});

	it("handles aliased links", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "notes/missing|alias text": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.target).toBe("notes/missing");
	});

	it("replaces an aliased wiki link with its alias", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Missing",
						original: "[[Missing|Readable Label]]",
						displayText: "Readable Label",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { Missing: 1 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			kind: "remove-link-text",
			label: "Remove link",
			description: 'Replace "[[Missing|Readable Label]]" with "Readable Label" in "Source.md"',
			linkText: "Missing|Readable Label",
			original: "[[Missing|Readable Label]]",
			replacement: "Readable Label",
		}));
		expect(issues[0].evidence.linkKind).toBe("note-link");
	});

	it("replaces a plain wiki link with its target text", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Missing Note",
						original: "[[Missing Note]]",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { "Missing Note": 1 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			original: "[[Missing Note]]",
			replacement: "Missing Note",
		}));
	});

	it("removes a missing embed entirely", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					embeds: [{
						link: "missing.png",
						original: "![[missing.png]]",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { "missing.png": 1 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.linkKind).toBe("embed");
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			kind: "remove-link-text",
			description: 'Remove "![[missing.png]]" from "Source.md"',
			original: "![[missing.png]]",
			replacement: "",
		}));
	});

	it("replaces a markdown link with its label text", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "missing-target.md",
						original: "[Readable Markdown](missing-target.md)",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { "missing-target.md": 1 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.linkKind).toBe("markdown-link");
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			kind: "remove-link-text",
			description: 'Replace "[Readable Markdown](missing-target.md)" with "Readable Markdown" in "Source.md"',
			original: "[Readable Markdown](missing-target.md)",
			replacement: "Readable Markdown",
		}));
		// Wiki inner text does not exist for markdown syntax — no linkText.
		expect(issues[0].fixAction?.linkText).toBeUndefined();
	});

	it("removes a markdown embed entirely", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					embeds: [{
						link: "missing.png",
						original: "![alt](missing.png)",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { "missing.png": 1 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.linkKind).toBe("embed");
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			original: "![alt](missing.png)",
			replacement: "",
		}));
	});

	it("offers a label-preserving replacement for broken markdown heading links", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [
				{ path: "Source.md" },
				{ path: "Target.md" },
			],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Target#Missing",
						original: "[Target](Target.md#Missing)",
						position: {} as any,
					}],
				},
				"Target.md": {
					headings: [{
						heading: "Existing",
						level: 1,
						position: {} as any,
					}],
				},
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("warning");
		expect(issues[0].evidence.linkKind).toBe("markdown-link");
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			kind: "remove-link-text",
			original: "[Target](Target.md#Missing)",
			replacement: "Target",
		}));
	});

	it("keeps an exact replacement action for aliased wiki heading links", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "Missing",
						original: "[[Missing|Alias]]",
						displayText: "Alias",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { Missing: 1 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			kind: "remove-link-text",
			linkText: "Missing|Alias",
			original: "[[Missing|Alias]]",
			replacement: "Alias",
		}));
	});

	it("withholds the fix action when plain and aliased references merge", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [
						{
							link: "Missing Note",
							original: "[[Missing Note]]",
							position: {} as any,
						},
						{
							link: "Missing Note",
							original: "[[Missing Note|Readable Label]]",
							displayText: "Readable Label",
							position: {} as any,
						},
					],
				},
			},
			unresolvedLinks: {
				"Source.md": { "Missing Note": 2 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].evidence.link).toBe("Missing Note");
		expect(issues[0].message).toBe("Linked file not found: Missing Note");
		// Differing originals: one action cannot cover both occurrences.
		expect(issues[0].fixAction).toBeUndefined();
	});

	it("keeps the fix action when merged references share the same original", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [
						{
							link: "Missing Note",
							original: "[[Missing Note|Label]]",
							position: {} as any,
						},
						{
							link: "Missing Note",
							original: "[[Missing Note|Label]]",
							position: {} as any,
						},
					],
				},
			},
			unresolvedLinks: {
				"Source.md": { "Missing Note": 2 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].fixAction).toEqual(expect.objectContaining({
			original: "[[Missing Note|Label]]",
			replacement: "Label",
		}));
	});

	it("withholds the fix action when one merged reference has no original", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [
						{
							link: "Missing Note",
							original: "[[Missing Note]]",
							position: {} as any,
						},
						{
							link: "Missing Note",
							position: {} as any,
						},
					],
				},
			},
			unresolvedLinks: {
				"Source.md": { "Missing Note": 2 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].fixAction).toBeUndefined();
	});

	it("detects missing attachment links and marks them as attachments", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "notes/a.md" }],
			unresolvedLinks: {
				"notes/a.md": { "assets/image.png": 1 },
			},
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("error");
		expect(issues[0].message).toContain("Attachment");
		expect(issues[0].evidence.linkKind).toBe("attachment");
		// No cache reference → no original → no fix action.
		expect(issues[0].fixAction).toBeUndefined();
	});

	it("does not report short wiki attachment links that match files in attachment folders", async () => {
		const file = { path: "notes/a.md" } as any;
		const image = { path: "attachments/image.png" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file, image],
			filePathIndex: new Set(["notes/a.md", "attachments/image.png"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "image.png": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("does not report short wiki note links that match files outside the current folder", async () => {
		const file = { path: "notes/a.md" } as any;
		const targetFile = { path: "articles/Linked Note.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file, targetFile],
			allFiles: [file, targetFile],
			filePathIndex: new Set(["notes/a.md", "articles/Linked Note.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "Linked Note": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files in ignored folders", async () => {
		const file = { path: "templates/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["templates/a.md"]),
			ignoredFolders: ["templates"],
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"templates/a.md": { missing: 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files with no cache", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => null,
				unresolvedLinks: {},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files with no unresolved links", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("resolves links with .md extension appended", async () => {
		const file = { path: "notes/a.md" } as any;
		const targetFile = { path: "notes/b.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file, targetFile],
			allFiles: [file, targetFile],
			filePathIndex: new Set(["notes/a.md", "notes/b.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { "notes/b": 1 },
				},
			} as any,
		});
		const issues = await brokenLinksScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("produces stable fingerprints for the same issue", async () => {
		const file = { path: "notes/a.md" } as any;
		const ctx = makeCtx({
			markdownFiles: [file],
			allFiles: [file],
			filePathIndex: new Set(["notes/a.md"]),
			metadataCache: {
				getFileCache: () => ({}),
				unresolvedLinks: {
					"notes/a.md": { missing: 1 },
				},
			} as any,
		});
		const issues1 = await brokenLinksScanner.scan(ctx);
		const issues2 = await brokenLinksScanner.scan(ctx);
		expect(issues1[0].fingerprint).toBe(issues2[0].fingerprint);
	});

	it("produces stable fingerprints across reference shape changes", async () => {
		// The same missing target, first discovered only through
		// unresolvedLinks, then with a cache reference carrying an original:
		// evidence gains linkKind and a fixAction appears, but the
		// fingerprint input ({ link, target }) is identical.
		const base = {
			scanner: "broken-links" as const,
			files: [{ path: "Source.md" }],
			unresolvedLinks: { "Source.md": { Missing: 1 } },
		};
		const withoutReference = await brokenLinksScanner.scan(
			makeScanContext(base),
		);
		const withReference = await brokenLinksScanner.scan(
			makeScanContext({
				...base,
				metadataByPath: {
					"Source.md": {
						links: [{
							link: "Missing",
							original: "[[Missing]]",
							position: {} as any,
						}],
					},
				},
			}),
		);
		expect(withReference).toHaveLength(1);
		expect(withoutReference).toHaveLength(1);
		expect(withReference[0].fingerprint).toBe(withoutReference[0].fingerprint);
	});

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
		expect(issues[0].fixAction).toBeUndefined();
	});

	it("keeps a target referenced by both a plain wikilink and an embed, without a fix", async () => {
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
		// Embed and non-embed originals differ by the leading "!" — ambiguous.
		expect(issues[0].fixAction).toBeUndefined();
	});

	it("keeps non-embed wikilinks to missing attachments when unresolved note links are ignored", async () => {
		const ctx = makeScanContext({
			scanner: "broken-links",
			files: [{ path: "Source.md" }],
			metadataByPath: {
				"Source.md": {
					links: [{
						link: "missing.png",
						original: "[[missing.png]]",
						position: {} as any,
					}],
				},
			},
			unresolvedLinks: {
				"Source.md": { "missing.png": 1 },
			},
			overrides: { ignoreUnresolvedNoteLinks: true },
		});

		const issues = await brokenLinksScanner.scan(ctx);

		expect(issues).toHaveLength(1);
		expect(issues[0].message).toBe("Attachment not found: missing.png");
		expect(issues[0].severity).toBe("error");
	});
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/broken-links.test.ts
```

Expected: FAIL — `FixAction` has no `original`/`replacement` (type errors at
test expectations), markdown links get no fix action, merged plain+aliased
candidates still emit the first reference's action, and `evidence.linkKind`
does not exist.

---

### Task 3: Add the additive `FixAction` fields

**Files:**
- Modify: `src/scanner/Issue.ts`

- [ ] **Step 1: Extend the `FixAction` type**

Replace (lines 25–32):

```typescript
export type FixAction = {
	kind: FixActionKind;
	label: string;
	description: string;
	targetPaths: string[];
	linkText?: string;
	selection?: KeepOneSelection;
};
```

with:

```typescript
export type FixAction = {
	kind: FixActionKind;
	label: string;
	description: string;
	targetPaths: string[];
	linkText?: string;
	/** Exact literal source syntax the fix locates, e.g. "[[Missing|Label]]". */
	original?: string;
	/** Text substituted in place of `original`; "" removes the range. */
	replacement?: string;
	selection?: KeepOneSelection;
};
```

---

### Task 4: Rewrite the scanner

**Files:**
- Modify: `src/scanner/scanners/broken-links.ts` (full rewrite)

- [ ] **Step 1: Replace the entire scanner file with:**

```typescript
import type { Issue } from "../Issue";
import type { ScanContext } from "../ScanContext";
import { describeFinding } from "../finding-presentation";
import { generateFingerprint } from "../issue-fingerprint";
import { isIgnoredPath } from "../../utils/paths";
import {
	getLinkTarget,
	hasUriScheme,
	resolveVaultLinkTargets,
} from "../../utils/vault-links";

type LinkFix = {
	/** Verbatim source syntax (from LinkCache.original / EmbedCache.original). */
	original: string;
	/** Text left in place of `original`; "" removes the range (embeds). */
	replacement: string;
};

type LinkCandidate = {
	linkText: string;
	fixLinkText?: string;
	fix?: LinkFix;
	isEmbed: boolean;
	isMarkdown: boolean;
	ignorableUnresolvedNote: boolean;
};

type LinkReference = {
	reference: {
		link: string;
		original?: string;
	};
	isEmbed: boolean;
};

export const brokenLinksScanner = {
	id: "broken-links" as const,

	scan(ctx: ScanContext): Issue[] {
		const issues: Issue[] = [];
		const { markdownFiles, metadataCache } = ctx;

		for (const file of markdownFiles) {
			if (isIgnoredPath(file.path, ctx.ignoredFolders)) continue;

			const cache = metadataCache.getFileCache(file);
			if (!cache) continue;

			const meta = metadataCache as unknown as {
				unresolvedLinks?: Record<string, Record<string, number>>;
			};
			const linksForFile = meta.unresolvedLinks?.[file.path];
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
				if (!existing) {
					linkCandidates.set(candidate.linkText, candidate);
					return;
				}
				linkCandidates.set(candidate.linkText, {
					linkText: candidate.linkText,
					fixLinkText: existing.fixLinkText ?? candidate.fixLinkText,
					// A fix targets one exact source range. When merged references
					// disagree on the original syntax (plain vs aliased, wiki vs
					// markdown, embed vs non-embed) or one of them has no original,
					// a single action cannot cover every occurrence — withhold it
					// and keep the finding reviewable.
					fix: existing.fix && candidate.fix
						&& existing.fix.original === candidate.fix.original
						? existing.fix
						: undefined,
					isEmbed: existing.isEmbed || candidate.isEmbed,
					isMarkdown: existing.isMarkdown || candidate.isMarkdown,
					ignorableUnresolvedNote:
						existing.ignorableUnresolvedNote && candidate.ignorableUnresolvedNote,
				});
			};

			for (const unresolvedLink of Object.keys(linksForFile ?? {})) {
				const matchingReferences = references.filter(
					({ reference }) => reference.link === unresolvedLink,
				);
				if (matchingReferences.length === 0) {
					addCandidate({
						linkText: unresolvedLink,
						isEmbed: false,
						isMarkdown: false,
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

			for (const candidate of linkCandidates.values()) {
				issues.push(...resolveLinkIssues(ctx, file.path, candidate));
			}
		}

		return issues;
	},
};

function resolveLinkIssues(
	ctx: ScanContext,
	sourcePath: string,
	candidate: LinkCandidate,
): Issue[] {
	const issues: Issue[] = [];
	const linkText = candidate.linkText;

	const rawTarget = getLinkTarget(linkText);

	if (!rawTarget || hasUriScheme(rawTarget)) return issues;

	// Attachment link (has a known non-md extension)
	if (isAttachmentLink(rawTarget)) {
		if (!findResolvedPath(ctx, rawTarget, sourcePath)) {
			issues.push(
				makeIssue(
					sourcePath,
					candidate,
					rawTarget,
					"error",
					`Attachment not found: ${rawTarget}`,
					candidate.isEmbed ? "embed" : "attachment",
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
		if (ctx.ignoreUnresolvedNoteLinks && candidate.ignorableUnresolvedNote) {
			return issues;
		}
		issues.push(
			makeIssue(
				sourcePath,
				candidate,
				rawTarget,
				"error",
				`Linked file not found: ${rawTarget}`,
				candidate.isEmbed
					? "embed"
					: candidate.isMarkdown
						? "markdown-link"
						: "note-link",
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
					candidate,
					resolvedPath,
					"warning",
					`Heading "#${headingPart}" not found in ${resolvedPath}`,
					candidate.isEmbed
						? "embed"
						: candidate.isMarkdown
							? "markdown-link"
							: "heading",
				),
			);
		}
	}

	return issues;
}

function getLinkCandidate({ reference, isEmbed }: LinkReference): LinkCandidate {
	const original = reference.original ?? "";
	const wikiMatch = original.match(/^(!?)\[\[([\s\S]+)\]\]$/);
	if (wikiMatch) {
		const inner = wikiMatch[2];
		return {
			// Obsidian's LinkCache.link already strips the alias, so the candidate
			// key must use it — the full inner text survives only as fix text.
			linkText: reference.link,
			fixLinkText: inner,
			fix: {
				original,
				// Embeds render their target, not their text: removal is the
				// only faithful transform.
				replacement: wikiMatch[1] ? "" : deriveWikiReplacement(inner),
			},
			isEmbed,
			isMarkdown: false,
			ignorableUnresolvedNote: !isEmbed && !wikiMatch[1],
		};
	}
	const markdownMatch = original.match(/^(!?)\[([^\]]*)\]\(\s*(?:<[^>]+>|[^)\s]*)\s*\)$/);
	if (markdownMatch) {
		return {
			linkText: reference.link,
			fix: {
				original,
				replacement: markdownMatch[1] ? "" : markdownMatch[2],
			},
			isEmbed: Boolean(markdownMatch[1]),
			isMarkdown: true,
			ignorableUnresolvedNote: false,
		};
	}
	return {
		linkText: reference.link,
		isEmbed,
		isMarkdown: !isEmbed && original.startsWith("["),
		ignorableUnresolvedNote: false,
	};
}

/** Wiki replacement text: the alias when present, otherwise the inner text. */
function deriveWikiReplacement(inner: string): string {
	const pipeIndex = inner.indexOf("|");
	return pipeIndex === -1 ? inner : inner.slice(pipeIndex + 1);
}

function isAttachmentLink(target: string): boolean {
	const lastSegment = target.split("/").pop() ?? "";
	const dotIndex = lastSegment.lastIndexOf(".");
	if (dotIndex === -1) return false;
	const ext = lastSegment.slice(dotIndex + 1).toLowerCase();
	return ext !== "md";
}

function findMarkdownPath(
	ctx: ScanContext,
	linkDestination: string,
	sourcePath: string,
): string | null {
	const resolvedPath = findResolvedPath(ctx, linkDestination, sourcePath);
	return resolvedPath?.endsWith(".md") ? resolvedPath : null;
}

function findResolvedPath(
	ctx: ScanContext,
	linkDestination: string,
	sourcePath: string,
): string | null {
	if (typeof ctx.metadataCache.getFirstLinkpathDest === "function") {
		return ctx.metadataCache.getFirstLinkpathDest(
			linkDestination,
			sourcePath,
		)?.path ?? null;
	}
	return resolveVaultLinkTargets(
		ctx,
		linkDestination,
		sourcePath,
	)[0] ?? null;
}

function slugifyHeading(heading: string): string {
	return heading
		.toLowerCase()
		.trim()
		.replace(/[^\p{L}\p{N}_\s-]/gu, "")
		.replace(/\s+/g, "-");
}

function makeIssue(
	sourcePath: string,
	candidate: LinkCandidate,
	targetPath: string,
	severity: "error" | "warning" | "info",
	message: string,
	linkKind: "note-link" | "markdown-link" | "attachment" | "heading" | "embed",
): Issue {
	const issue: Issue = {
		scannerId: "broken-links",
		severity,
		title: "Broken link",
		message,
		primaryPath: sourcePath,
		relatedPaths: [targetPath],
		evidence: { link: candidate.linkText, target: targetPath, linkKind },
		...describeFinding(
			"confirmed",
			severity === "error"
				? "The link target could not be resolved in the vault."
				: "The target note exists, but the referenced heading was not found.",
			severity === "error"
				? "Correct the target or remove the link from the source note."
				: "Correct the heading reference or remove it from the source note.",
		),
		fingerprint: generateFingerprint("broken-links", sourcePath, {
			link: candidate.linkText,
			target: targetPath,
		}),
	};
	if (candidate.fix) {
		const fix = candidate.fix;
		issue.fixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: fix.replacement === ""
				? `Remove "${fix.original}" from "${sourcePath}"`
				: `Replace "${fix.original}" with "${fix.replacement}" in "${sourcePath}"`,
			targetPaths: [sourcePath],
			...(candidate.fixLinkText ? { linkText: candidate.fixLinkText } : {}),
			original: fix.original,
			replacement: fix.replacement,
		};
	}
	return issue;
}
```

Design notes for reviewers:

- The fingerprint input stays `{ link, target }` — `linkKind` evidence and
  the fix fields never enter it, so fingerprints of every surviving finding
  are byte-identical and user ignore lists survive.
- `ignorableUnresolvedNote` keeps its exact post-#125 derivation: true only
  for non-embed wiki links whose `original` starts with `[[` (the wiki match
  with no leading `!`). Markdown-syntax references are never ignorable.
- `linkKind` precedence: embed > attachment > markdown-link > heading >
  note-link (a markdown heading link reports `markdown-link`; the heading
  context is already in `message` and `severity`).
- Markdown fixes omit `linkText` — wiki inner text does not exist for that
  syntax, and `linkText` keeps its established meaning.

- [ ] **Step 2: Run the scanner unit tests**

```bash
npm test -- src/tests/broken-links.test.ts
```

Expected: PASS (30 tests). `src/tests/fix-executor.test.ts` and
`src/tests/scanner-precision.test.ts` still fail (next tasks): the executor
ignores the new fields, and the precision assertions pin the old fix
availability.

---

### Task 5: Update the executor

**Files:**
- Modify: `src/fix/fix-executor.ts`

- [ ] **Step 1: Route `remove-link-text` through literal replacement when available**

Replace (lines 4–13):

```typescript
export async function executeFixAction(app: App, action: FixAction): Promise<number> {
	switch (action.kind) {
		case "trash-file":
			return trashFiles(app, action.targetPaths);
		case "remove-link-text":
			return removeLinkText(app, action.targetPaths[0], action.linkText!);
		default:
			return 0;
	}
}
```

with:

```typescript
export async function executeFixAction(app: App, action: FixAction): Promise<number> {
	switch (action.kind) {
		case "trash-file":
			return trashFiles(app, action.targetPaths);
		case "remove-link-text": {
			const source = action.targetPaths[0];
			if (action.original !== undefined) {
				return replaceLinkText(app, source, action.original, action.replacement ?? "");
			}
			return removeLinkText(app, source, action.linkText!);
		}
		default:
			return 0;
	}
}
```

- [ ] **Step 2: Add `replaceLinkText` below `removeLinkText`**

Insert after the `removeLinkText` function (after line 54, before
`type TextRange`):

```typescript
/**
 * Replace every unprotected occurrence of the literal `original` syntax with
 * `replacement` ("" removes the range). Preferred over the legacy wiki
 * pattern when the fix action carries exact source metadata.
 */
async function replaceLinkText(
	app: App,
	sourcePath: string,
	original: string,
	replacement: string,
): Promise<number> {
	const file = app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) return 0;

	const content = await app.vault.read(file);
	// Negative lookbehind: a wiki original "[[x]]" is a substring of the embed
	// "![[x]]" (and a markdown original of its image form "![](x)"). Non-embed
	// actions must never consume an embed occurrence; embed actions carry the
	// "!" in their original and match exactly.
	const pattern = new RegExp(`(?<!!)${escapeRegex(original)}`, "g");
	const protectedRanges = findProtectedMarkdownRanges(content);
	let cursor = 0;
	let updated = "";
	let replaced = false;

	for (const match of content.matchAll(pattern)) {
		const start = match.index;
		const end = start + match[0].length;
		if (protectedRanges.some((range) => start < range.end && end > range.start)) {
			continue;
		}
		updated += content.slice(cursor, start) + replacement;
		cursor = end;
		replaced = true;
	}
	if (replaced) updated += content.slice(cursor);
	else updated = content;
	if (updated === content) return 0;

	await app.vault.modify(file, updated);
	return 1;
}
```

`findProtectedMarkdownRanges`, `removeLinkText`, and all helpers are
unchanged — fenced code, inline code, and HTML comments keep being skipped
by both paths.

---

### Task 6: Rewrite the executor tests

**Files:**
- Modify: `src/tests/fix-executor.test.ts` (full rewrite)

Replace the entire file with:

```typescript
import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { executeFixAction } from "../fix/fix-executor";
import { brokenLinksScanner } from "../scanner/scanners/broken-links";
import type { FixAction } from "../scanner/Issue";
import { makeScanContext } from "./helpers/scan-context";

async function makeAliasedHeadingFixAction(): Promise<FixAction> {
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
						link: "Target#Missing heading",
						original: "[[Target#Missing heading|missing]]",
						displayText: "missing",
						position: {} as any,
					},
					{
						link: "Target#Other heading",
						original: "[[Target#Other heading|other]]",
						displayText: "other",
						position: {} as any,
					},
				],
			},
			"Target.md": {
				headings: [
					{
						heading: "Other heading",
						level: 2,
						position: {} as any,
					},
				],
			},
		},
	});

	const issues = await brokenLinksScanner.scan(ctx);
	expect(issues).toHaveLength(1);
	expect(issues[0].fixAction).toBeDefined();
	return issues[0].fixAction!;
}

function makeApp(content: string) {
	const file = Object.assign(new TFile(), { path: "Source.md" });
	const modify = vi.fn(async () => {});
	const app = {
		vault: {
			getAbstractFileByPath: vi.fn(() => file),
			read: vi.fn(async () => content),
			modify,
		},
	};
	return { app, file, modify };
}

describe("executeFixAction", () => {
	it("replaces the aliased wiki link with its alias and preserves other headings", async () => {
		const action = await makeAliasedHeadingFixAction();
		const content = [
			"[[Target#Missing heading|missing]]",
			"[[Target#Other heading|other]]",
			"[[Target|plain]]",
			"![[Target#Missing heading|missing]]",
		].join("\n");
		const { app, file, modify } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(action.linkText).toBe("Target#Missing heading|missing");
		expect(action.original).toBe("[[Target#Missing heading|missing]]");
		expect(action.replacement).toBe("missing");
		expect(modify).toHaveBeenCalledWith(
			file,
			[
				"missing",
				"[[Target#Other heading|other]]",
				"[[Target|plain]]",
				// The embed occurrence is NOT consumed: the literal pattern is
				// anchored with a negative lookbehind for "!".
				"![[Target#Missing heading|missing]]",
			].join("\n"),
		);
	});

	it("replaces markdown links with their label text", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "",
			targetPaths: ["Source.md"],
			original: "[Readable Markdown](missing-target.md)",
			replacement: "Readable Markdown",
		};
		const content = [
			"Prefix [Readable Markdown](missing-target.md) suffix.",
			"![Readable Markdown](missing-target.md)",
		].join("\n");
		const { app, file, modify } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(modify).toHaveBeenCalledWith(
			file,
			[
				"Prefix Readable Markdown suffix.",
				"![Readable Markdown](missing-target.md)",
			].join("\n"),
		);
	});

	it("removes embeds entirely, including the leading bang", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "",
			targetPaths: ["Source.md"],
			original: "![[missing-embed.png]]",
			replacement: "",
		};
		const content = "Before ![[missing-embed.png]] after";
		const { app, file, modify } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(modify).toHaveBeenCalledWith(file, "Before  after");
	});

	it("still supports the legacy linkText wiki path", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "",
			targetPaths: ["Source.md"],
			linkText: "Legacy|Alias",
		};
		const content = "Keep [[Legacy|Alias]] here";
		const { app, file, modify } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(modify).toHaveBeenCalledWith(file, "Keep  here");
	});

	it("returns 0 when the original syntax is no longer present", async () => {
		const action: FixAction = {
			kind: "remove-link-text",
			label: "Remove link",
			description: "",
			targetPaths: ["Source.md"],
			original: "[[Gone]]",
			replacement: "Gone",
		};
		const { app, modify } = makeApp("Nothing to see");

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(0);
		expect(modify).not.toHaveBeenCalled();
	});

	it("does not replace inside code or HTML comments", async () => {
		const action = await makeAliasedHeadingFixAction();
		const content = [
			"Before [[Target#Missing heading|missing]] after",
			"`[[Target#Missing heading|missing]]`",
			"``inline [[Target#Missing heading|missing]] with ` tick``",
			"```md",
			"[[Target#Missing heading|missing]]",
			"```",
			"<!-- [[Target#Missing heading|missing]] -->",
		].join("\n");
		const { app, file, modify } = makeApp(content);

		const fixed = await executeFixAction(app as any, action);

		expect(fixed).toBe(1);
		expect(modify).toHaveBeenCalledWith(
			file,
			[
				"Before missing after",
				"`[[Target#Missing heading|missing]]`",
				"``inline [[Target#Missing heading|missing]] with ` tick``",
				"```md",
				"[[Target#Missing heading|missing]]",
				"```",
				"<!-- [[Target#Missing heading|missing]] -->",
			].join("\n"),
		);
	});
});
```

- [ ] **Step 2: Run the executor tests**

```bash
npm test -- src/tests/fix-executor.test.ts
```

Expected: PASS (6 tests).

---

### Task 7: Update the precision suite (assertions only)

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

Fixture files stay unchanged. `EXPECTED_INVENTORY` stays exactly 15 lines —
inventory lines are built from `scannerId | severity | classification |
paths | message`, none of which change (`linkKind` evidence and fix metadata
are not part of `inventoryLine`).

- [ ] **Step 1: Replace the five-findings broken-links test**

Replace the whole `it("reports five findings for the broken-links note with current fix availability", ...)` block:

```typescript
		it("reports five findings for the broken-links note with current fix availability", async () => {
			const { issues } = await scanFixtureVault();
			const broken = issues.filter(
				(issue) =>
					issue.scannerId === "broken-links" &&
					issue.primaryPath === "notes/hub/broken-links.md",
			);
			expect(broken).toHaveLength(5);
			expect(broken.every((issue) => issue.classification === "confirmed")).toBe(true);

			const byLink = new Map(broken.map((issue) => [issue.evidence.link, issue]));

			// The plain and aliased references merge into one finding (Obsidian's
			// cache strips aliases from LinkCache.link); document order makes the
			// plain reference's fix text win.
			expect(byLink.get("Missing Note")).toMatchObject({
				message: "Linked file not found: Missing Note",
				severity: "error",
				evidence: { link: "Missing Note", target: "Missing Note" },
				fixAction: { kind: "remove-link-text", linkText: "Missing Note" },
			});
			expect(byLink.has("Missing Note|Readable Label")).toBe(false);
			// Markdown links currently get no fix action — Milestone 1.5 target.
			expect(byLink.get("missing-target.md")).toMatchObject({
				message: "Linked file not found: missing-target.md",
				severity: "error",
			});
			expect(byLink.get("missing-target.md")?.fixAction).toBeUndefined();
			expect(byLink.get("missing-photo.png")).toMatchObject({
				message: "Attachment not found: missing-photo.png",
				severity: "error",
				fixAction: { kind: "remove-link-text" },
			});
			expect(byLink.get("missing-embed.png")).toMatchObject({
				message: "Attachment not found: missing-embed.png",
				severity: "error",
				fixAction: { kind: "remove-link-text" },
			});
			expect(byLink.get("target#Missing Heading")).toMatchObject({
				message: 'Heading "#Missing Heading" not found in notes/target.md',
				severity: "warning",
				relatedPaths: ["notes/target.md"],
				fixAction: { kind: "remove-link-text", linkText: "target#Missing Heading" },
			});
		});
```

with:

```typescript
		it("reports five findings for the broken-links note with label-preserving fixes", async () => {
			const { issues } = await scanFixtureVault();
			const broken = issues.filter(
				(issue) =>
					issue.scannerId === "broken-links" &&
					issue.primaryPath === "notes/hub/broken-links.md",
			);
			expect(broken).toHaveLength(5);
			expect(broken.every((issue) => issue.classification === "confirmed")).toBe(true);

			const byLink = new Map(broken.map((issue) => [issue.evidence.link, issue]));

			// The plain and aliased references merge into one finding (Obsidian's
			// cache strips aliases from LinkCache.link). Their originals differ
			// ("[[Missing Note]]" vs "[[Missing Note|Readable Label]]"), so one
			// action cannot cover both occurrences — the fix is withheld.
			expect(byLink.get("Missing Note")).toMatchObject({
				message: "Linked file not found: Missing Note",
				severity: "error",
				evidence: { link: "Missing Note", target: "Missing Note", linkKind: "note-link" },
			});
			expect(byLink.get("Missing Note")?.fixAction).toBeUndefined();
			expect(byLink.has("Missing Note|Readable Label")).toBe(false);
			// Markdown links now carry a label-preserving replacement action.
			expect(byLink.get("missing-target.md")).toMatchObject({
				message: "Linked file not found: missing-target.md",
				severity: "error",
				evidence: { linkKind: "markdown-link" },
				fixAction: {
					kind: "remove-link-text",
					original: "[Readable Markdown](missing-target.md)",
					replacement: "Readable Markdown",
				},
			});
			expect(byLink.get("missing-photo.png")).toMatchObject({
				message: "Attachment not found: missing-photo.png",
				severity: "error",
				evidence: { linkKind: "attachment" },
				fixAction: {
					kind: "remove-link-text",
					original: "[[missing-photo.png]]",
					replacement: "missing-photo.png",
				},
			});
			expect(byLink.get("missing-embed.png")).toMatchObject({
				message: "Attachment not found: missing-embed.png",
				severity: "error",
				evidence: { linkKind: "embed" },
				fixAction: {
					kind: "remove-link-text",
					original: "![[missing-embed.png]]",
					replacement: "",
				},
			});
			expect(byLink.get("target#Missing Heading")).toMatchObject({
				message: 'Heading "#Missing Heading" not found in notes/target.md',
				severity: "warning",
				relatedPaths: ["notes/target.md"],
				evidence: { linkKind: "heading" },
				fixAction: {
					kind: "remove-link-text",
					linkText: "target#Missing Heading",
					original: "[[target#Missing Heading]]",
					replacement: "target#Missing Heading",
				},
			});
		});
```

- [ ] **Step 2: Run the precision suite**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS, with `EXPECTED_INVENTORY` unchanged at 15 lines.

---

### Task 8: Focused verification, full gates, commit, PR

- [ ] **Step 1: Roadmap focused verification**

```bash
npm test -- src/tests/broken-links.test.ts src/tests/fix-executor.test.ts
```

Expected: PASS — supported fixes preserve readable content and never modify
protected Markdown regions.

- [ ] **Step 2: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0. No other suite depends on broken-links fix shapes
(`src/tests/main.test.ts`, `inspector-view-filters.test.ts`,
`confirm-modal.test.ts`, and `scan-snapshot.test.ts` construct their own
issue literals with `kind`/`label`/`targetPaths`, which are unchanged).

- [ ] **Step 3: Confirm the diff is scoped**

```bash
git diff --stat main
```

Expected: only `src/scanner/Issue.ts`,
`src/scanner/scanners/broken-links.ts`, `src/fix/fix-executor.ts`,
`src/tests/broken-links.test.ts`, `src/tests/fix-executor.test.ts`,
`src/tests/scanner-precision.test.ts`. NOT any fixture file under
`src/tests/fixtures/`, nor `src/scanner/ScanContext.ts`,
`src/scanner/ScanRunner.ts`, `src/report/*`, `src/fix/confirm-modal.ts`,
`src/snapshot/*`, `src/main.ts`, `src/settings/*`, or `cli/`.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/Issue.ts src/scanner/scanners/broken-links.ts src/fix/fix-executor.ts src/tests/broken-links.test.ts src/tests/fix-executor.test.ts src/tests/scanner-precision.test.ts
git commit -m "fix: preserve labels when removing broken links"
git push -u origin fix/broken-link-precision
```

- [ ] **Step 5: Open the PR** against `main`, titled
  `fix: preserve labels when removing broken links`, covering: transformation
  table implemented (aliased wiki → alias, plain wiki → target text, markdown
  → label, embed → removed; heading variants follow the same rule);
  structured fix metadata (additive `FixAction.original`/`replacement`, CLI
  JSON additive, legacy `linkText` executor path kept for persisted
  decisions); ambiguity guard (merged references with differing or missing
  originals withhold the action — the fixture's plain+aliased `Missing Note`
  merge now renders review-only instead of silently fixing half the
  occurrences); markdown links gain fix availability (both the CLI adapter
  and real `LinkCache` carry `original`); evidence distinction
  (`linkKind`: embed / attachment / markdown-link / heading / note-link);
  protected regions still skipped plus a `(?<!!)` guard so non-embed actions
  never consume embed occurrences; `ignoreUnresolvedNoteLinks` semantics and
  fingerprints unchanged (`COMPARISON_VERSION` stays `1`); precision
  inventory unchanged at 15 lines (assertion updates only); focused tests
  plus full gates run.

## Self-review checklist (completed during plan writing)

- Roadmap Task 1.5 requirements ↔ tasks: transformation table ✓ (Task 4 `getLinkCandidate`/`deriveWikiReplacement` — alias after the first `|`, inner text otherwise; markdown label from the bracket text; embeds `""`); structured fix metadata ✓ (Task 3 `original`/`replacement` on `FixAction`, additive); protected regions ✓ (Task 5 reuses `findProtectedMarkdownRanges`, Task 6 keeps the code/comment test); evidence distinction ✓ (`linkKind` scalar, precedence embed > attachment > markdown-link > heading > note-link); `ignoreUnresolvedNoteLinks` semantics ✓ (`ignorableUnresolvedNote` derivation byte-identical to post-#125; kept tests "ignores unresolved plain note wikilinks", "keeps non-plain-link failures", "keeps non-embed wikilinks to missing attachments"); ambiguity guard ✓ (Task 4 merge rule — fix survives only when all merged references share one `original`; tests for plain+aliased, one-sided missing original, embed+plain).
- Roadmap verification command reproduced in Task 8 Step 1 with the roadmap's expected outcome.
- No placeholders: full rewrites ship complete code for `broken-links.test.ts`, `broken-links.ts`, `fix-executor.test.ts`; `Issue.ts`, `fix-executor.ts`, and the precision-suite edits quote the exact current file contents before replacement (verified against `src/scanner/Issue.ts` lines 25–32, `src/fix/fix-executor.ts` lines 4–13 and 27–54, `src/tests/scanner-precision.test.ts` lines 74–118).
- Type/name consistency verified against the codebase: `FixAction` is the only type touched in `Issue.ts`; `describeFinding`/`generateFingerprint` signatures unchanged; `getLinkTarget`/`hasUriScheme`/`resolveVaultLinkTargets` imports unchanged; `makeScanContext` supports `metadataByPath` with `links`/`embeds`/`original` (used by existing tests); the scanner's `LinkReference` type already models `original?: string` post-#125.
- Markdown-link feasibility confirmed: the CLI adapter populates `original: match[0]` for markdown entries (`cli/local-vault.ts` lines 171–181) and real Obsidian `LinkCache.original` carries full syntax — the roadmap's `[label](missing) -> label` is implemented, and the precision suite gains that fixAction as an assertion update.
- Inventory impact reasoned: `inventoryLine` uses scannerId/severity/classification/paths/message — all unchanged; `linkKind` evidence and fix metadata are not part of it. **15 lines, byte-identical.**
- Executor guards: literal matching anchored with `(?<!!)` (ES2018 lookbehind, supported by Obsidian Electron and all Node targets) so `[[x]]` actions cannot consume `![[x]]` occurrences; legacy `linkText` path preserved verbatim for persisted snapshot fix decisions.
- Fingerprints byte-identical; `COMPARISON_VERSION` stays `1` with the justification recorded in the design doc and the PR description.
- Deviation from the roadmap's file list, documented: `src/tests/scanner-precision.test.ts` is updated (assertions only) alongside the roadmap's five files — the fixture-freeze precedent requires pinning the changed fix availability, and the roadmap's Task 1.4 PR did the same.
