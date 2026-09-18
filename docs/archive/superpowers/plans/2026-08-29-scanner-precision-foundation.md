# Scanner Precision Foundation Implementation Plan (Milestone 0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make scanner false positives measurable and scan performance reproducible by adding a committed precision fixture vault, an exact-findings precision test suite, and a deterministic non-network scan benchmark — with zero production code changes.

**Architecture:** A new fixture vault under `src/tests/fixtures/precision-vault/` is loaded through the shipped CLI adapter (`createLocalApp`) and scanned by the real `ScanRunner` with pinned mtimes, so plugin tests and CLI scans share identical reference semantics. A seeded synthetic-vault generator feeds both a CI smoke performance test and a standalone `npm run benchmark:scan` script that bundles the TypeScript sources with the existing esbuild devDependency (no experimental Node flags, no new dependencies).

**Tech Stack:** TypeScript, Vitest, Node.js (fs/perf_hooks), esbuild, Obsidian plugin test mocks

Design doc: `docs/superpowers/specs/2026-08-29-scanner-precision-foundation-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 0)

---

## Ground rules for this plan

- Branch: `feat/scanner-precision-foundation`, cut from latest `main`.
- No production file under `src/scanner/`, `src/report/`, `src/fix/`, `src/settings/`, `src/main.ts`, or `cli/` may be modified. If a test reveals a scanner bug, do not fix it here — record the observed behavior in the test with a comment naming the boundary, and report it in the PR description.
- Two commits total, matching the roadmap's suggested messages:
  1. `test: add scanner precision fixture vault` (Tasks 1–7)
  2. `test: add repeatable scan performance baseline` (Tasks 8–10)
- Reconciliation rule: if actual scanner output differs from an expected value in this plan, read the scanner source to confirm which is right. Fix the fixture (size/content collision) when the fixture is wrong; correct the expectation only after confirming the scanner's real behavior. Never weaken or delete an assertion to make a surprise pass.
- All markdown fixture files end with exactly one trailing newline. The attachment and duplicate-bin files created via `printf` have **no** trailing newline (byte-exact sizes matter).

## Expected findings inventory (reference for Tasks 3–5)

Default-settings pass (external-links disabled), 19 findings:

| # | Scanner | Severity | Classification | Path(s) | Message | Fix action |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | broken-links | error | confirmed | notes/hub/broken-links.md → Missing Note | `Linked file not found: Missing Note` | remove-link-text |
| 2 | broken-links | error | confirmed | notes/hub/broken-links.md → missing-target.md | `Linked file not found: missing-target.md` | none |
| 3 | broken-links | error | confirmed | notes/hub/broken-links.md → missing-photo.png | `Attachment not found: missing-photo.png` | remove-link-text |
| 4 | broken-links | error | confirmed | notes/hub/broken-links.md → missing-embed.png | `Attachment not found: missing-embed.png` | remove-link-text |
| 5 | broken-links | warning | confirmed | notes/hub/broken-links.md → notes/target.md | `Heading "#Missing Heading" not found in notes/target.md` | remove-link-text |
| 6 | orphan-attachments | warning | candidate | attachments/canvas-image.png | `This attachment is not referenced by any note` | trash-file |
| 7 | orphan-attachments | warning | candidate | attachments/orphan.png | `This attachment is not referenced by any note` | trash-file |
| 8 | orphan-attachments | info | candidate | attachments/recent-orphan.png | `This attachment is not referenced by any note` | trash-file |
| 9 | empty-notes | warning | candidate | notes/empty/genuine-empty.md | `This note has no content besides a title` | trash-file |
| 10 | empty-notes | warning | candidate | notes/empty/stub.md | `This note only has 3 words (likely a stub)` | trash-file |
| 11 | empty-notes | warning | candidate | notes/empty/frontmatter-only.md | `This note has no content besides a title` | trash-file |
| 12 | empty-notes | warning | candidate | notes/empty/title-only.md | `This note has no content besides a title` | trash-file |
| 13 | empty-notes | warning | candidate | notes/empty/short-link-moc.md | `This note only has 2 words (likely a stub)` | trash-file |
| 14 | empty-notes | warning | candidate | notes/empty/embed-only.md | `This note only has 1 word (likely a stub)` | trash-file |
| 15 | empty-notes | warning | candidate | notes/empty/task-note.md | `This note only has 5 words (likely a stub)` | trash-file |
| 16 | empty-notes | warning | candidate | notes/empty/cjk-stub.md | `This note only has 2 words (likely a stub)` | trash-file |
| 17 | duplicate-files | warning | confirmed | duplicates/backup/fixture-data.bin, duplicates/original/fixture-data.bin | `2 files have identical content` | trash-file keep-one (keeps duplicates/backup/fixture-data.bin) |
| 18 | duplicate-files | info | candidate | duplicates/archive/notes-a.txt, duplicates/notes-a.txt | `2 files share the name "notes-a.txt"` | none |
| 19 | duplicate-files | info | candidate | duplicates/size-twin-one.bin, duplicates/size-twin-two.bin | `2 files share size 48 B` | none |

Zero findings expected from: large-files, frontmatter-types, tag-usage, external-links (disabled), and from `notes/hub/valid-links.md`, `notes/hub/relative-and-unicode.md`, `notes/attachments-ref.md`, `notes/target.md`, `notes/hub/sibling-note.md`, `notes/unicode/目标笔记.md`, `notes/empty/link-only-moc.md`, `notes/empty/code-note.md`.

Known false-positive boundaries pinned by this inventory (Milestone 1 targets): rows 6 (Canvas-only reference), 13 (short link-only MOC), 14 (embed-only note), 15 (task note), and the 403/429/500 presentation in the external pass.

---

### Task 1: Create the fixture vault files

**Files:**
- Create: `src/tests/fixtures/precision-vault/notes/target.md`
- Create: `src/tests/fixtures/precision-vault/notes/hub/sibling-note.md`
- Create: `src/tests/fixtures/precision-vault/notes/hub/valid-links.md`
- Create: `src/tests/fixtures/precision-vault/notes/hub/broken-links.md`
- Create: `src/tests/fixtures/precision-vault/notes/hub/relative-and-unicode.md`
- Create: `src/tests/fixtures/precision-vault/notes/unicode/目标笔记.md`
- Create: `src/tests/fixtures/precision-vault/notes/attachments-ref.md`
- Create: `src/tests/fixtures/precision-vault/notes/external-links.md`
- Create: `src/tests/fixtures/precision-vault/notes/empty/` (10 files)
- Create: `src/tests/fixtures/precision-vault/canvas/board.canvas`
- Create: `src/tests/fixtures/precision-vault/attachments/` (6 files)
- Create: `src/tests/fixtures/precision-vault/duplicates/` (6 files)

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/scanner-precision-foundation
```

- [ ] **Step 2: Write the valid-reference notes**

`src/tests/fixtures/precision-vault/notes/target.md`:

```markdown
# Target

This note exists so link fixtures have a real destination with stable headings.

## Section One

Prose under section one gives this note enough words to stay outside the empty-note scanner.

## Section Two

More prose keeps the word count far above the default threshold of five words.
```

`src/tests/fixtures/precision-vault/notes/hub/sibling-note.md`:

```markdown
# Sibling Note

This sibling note lives next to the link fixtures so relative links have a nearby destination that resolves without folder traversal.
```

`src/tests/fixtures/precision-vault/notes/hub/valid-links.md`:

```markdown
# Valid Links

- Wiki link: [[Target]]
- Aliased link: [[Target|Custom Alias]]
- Heading link: [[Target#Section One]]
- Markdown link: [Target note](../target.md)
- Relative markdown link: [Sibling](./sibling-note.md)
- Attachment embed: ![[photo.jpg]]
```

`src/tests/fixtures/precision-vault/notes/hub/relative-and-unicode.md`:

```markdown
# Relative And Unicode

- Unicode note link: [[目标笔记]]
- Unicode embed: ![[目标图片.png]]
- Parent relative link: [Target again](../target.md)
```

`src/tests/fixtures/precision-vault/notes/unicode/目标笔记.md`:

```markdown
# 目标笔记

这篇笔记用于验证 Unicode 路径解析。内容足够长，不会被空笔记扫描器标记。
```

`src/tests/fixtures/precision-vault/notes/attachments-ref.md`:

```markdown
---
source: "[[frontmatter-doc.pdf]]"
---

# Attachment References

The embedded photo appears here:

![[photo.jpg]]
```

- [ ] **Step 3: Write the broken-links note**

`src/tests/fixtures/precision-vault/notes/hub/broken-links.md`:

```markdown
# Broken Links

- Missing note: [[Missing Note]]
- Missing note with alias: [[Missing Note|Readable Label]]
- Broken markdown link: [Readable Markdown](missing-target.md)
- Missing attachment: [[missing-photo.png]]
- Missing heading: [[Target#Missing Heading]]
- Missing embed: ![[missing-embed.png]]
```

Note: the aliased missing link resolves to the same link text `Missing Note` as row 1, so the scanner emits ONE finding for both occurrences (current dedup behavior — captured deliberately).

- [ ] **Step 4: Write the ten empty-notes fixtures**

`notes/empty/genuine-empty.md`:

```markdown
# Genuine Empty
```

`notes/empty/stub.md`:

```markdown
# Stub

Real stub note.
```

`notes/empty/frontmatter-only.md`:

```markdown
---
title: Frontmatter Only
---
```

`notes/empty/title-only.md`:

```markdown
# Only A Title
```

`notes/empty/link-only-moc.md` (8 links → passes today, must stay passing):

```markdown
# Link Only MOC

- [[Target]]
- [[sibling-note]]
- [[目标笔记]]
- [[Target#Section One]]
- [[genuine-empty]]
- [[frontmatter-only]]
- [[title-only]]
- [[stub]]
```

`notes/empty/short-link-moc.md` (2 links → false positive today, pinned):

```markdown
# Short MOC

[[Target]] [[sibling-note]]
```

`notes/empty/embed-only.md` (1 embed → false positive today, pinned):

```markdown
# Embed Only

![[photo.jpg]]
```

`notes/empty/task-note.md` (5 tokens → false positive today, pinned):

```markdown
# Task Note

- [ ] Ship this
```

`notes/empty/code-note.md` (passes today):

````markdown
# Code Note

```js
const answer = 42;
console.log(answer);
```
````

`notes/empty/cjk-stub.md` (2 CJK words → genuine stub, pinned):

```markdown
# 中文占位

你好
```

All ten files live under `src/tests/fixtures/precision-vault/notes/empty/`.

- [ ] **Step 5: Write the external-links and Canvas fixtures**

`src/tests/fixtures/precision-vault/notes/external-links.md` (tab-indented JSON in the canvas file; markdown here):

```markdown
# External Links

- https://status-200.example.com/ok
- https://status-404.example.com/gone
- https://status-403.example.com/private
- https://status-429.example.com/slow-down
- https://status-500.example.com/server-error
- https://request-error.example.com/network-failure
- http://127.0.0.1:9/internal-service
```

`src/tests/fixtures/precision-vault/canvas/board.canvas`:

```json
{
	"nodes": [
		{
			"id": "canvas-node-1",
			"type": "file",
			"file": "attachments/canvas-image.png",
			"x": 0,
			"y": 0,
			"width": 240,
			"height": 180
		}
	],
	"edges": []
}
```

- [ ] **Step 6: Create the attachment and duplicate files with byte-exact sizes**

Run from the repository root (printf avoids trailing newlines; sizes are chosen to be unique across the vault except the two intended pairs):

```bash
cd src/tests/fixtures/precision-vault
mkdir -p attachments duplicates/original duplicates/backup duplicates/archive

printf '%s' 'precision-vault photo fixture 0123456789' > attachments/photo.jpg
printf '%s' 'precision-vault frontmatter pdf fixture 0123456789' > attachments/frontmatter-doc.pdf
printf '%s' 'precision-vault canvas image fixture 0123456789' > attachments/canvas-image.png
printf '%s' 'precision-vault orphan fixture 0123456789' > attachments/orphan.png
printf '%s' 'precision-vault recent unreferenced fixture 0123456789' > attachments/recent-orphan.png
printf '%s' 'precision-vault unicode image payload 0123456789' > attachments/目标图片.png

printf '%s' 'vault-inspector hash identical fixture payload 0123456789' > duplicates/original/fixture-data.bin
printf '%s' 'vault-inspector hash identical fixture payload 0123456789' > duplicates/backup/fixture-data.bin
printf '%s' 'same name fixture content A' > duplicates/notes-a.txt
printf '%s' 'same name fixture content B with extra words' > duplicates/archive/notes-a.txt
printf '%s' '111111111111111111111111111111111111111111111111' > duplicates/size-twin-one.bin
printf '%s' '222222222222222222222222222222222222222222222222' > duplicates/size-twin-two.bin
```

Byte lengths for the audit (no trailing newlines): photo 39, frontmatter pdf 49, canvas 46, orphan 40, recent 53, unicode 47, fixture-data 56 (×2), notes-a 27, archive notes-a 44, size twins 48 (×2).

- [ ] **Step 7: Audit file sizes for unintended duplicate collisions**

Run from the repository root:

```bash
find src/tests/fixtures/precision-vault -type f -exec stat -f '%z %N' {} \; | sort -n | awk '{print $1}' | uniq -c | awk '$1 > 1'
```

Expected: exactly two lines of output — `2 48` (the size-twin pair) and `2 56` (the hash-identical pair). Any other duplicated size means an accidental same-size duplicate candidate: adjust that fixture's content length (add/remove words, keep meaning) until the audit shows only the two intended pairs. Also spot-check that the two `fixture-data.bin` files and only those hash-identical files share content:

```bash
find src/tests/fixtures/precision-vault -type f -exec shasum -a 256 {} \; | awk '{print $1}' | uniq -c | awk '$1 > 1'
```

Expected: one line showing count 2 (the hash pair).

---

### Task 2: Fixture loader helper and smoke test

**Files:**
- Create: `src/tests/helpers/fixture-vault.ts`
- Create: `src/tests/scanner-precision.test.ts`
- Reference: `cli/local-vault.ts` (read-only reuse)

- [ ] **Step 1: Write the failing smoke test**

Create `src/tests/scanner-precision.test.ts` with exactly this content:

```typescript
import { describe, expect, it } from "vitest";
import { scanFixtureVault } from "./helpers/fixture-vault";

describe("precision fixture vault", () => {
	it("loads the fixture vault through the CLI adapter and runs seven scanners", async () => {
		const { result, issues } = await scanFixtureVault();

		expect(result.filesScanned).toBe(31);
		expect(result.scannersRun).toHaveLength(7);
		expect(result.scannersRun).not.toContain("external-links");
		expect(issues).toBe(result.issues);
	});
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: FAIL — `Cannot find module './helpers/fixture-vault'` (or equivalent resolution error).

- [ ] **Step 3: Implement the loader**

Create `src/tests/helpers/fixture-vault.ts`:

```typescript
import { fileURLToPath } from "node:url";
import { createLocalApp } from "../../../cli/local-vault";
import { ScanRunner } from "../../scanner/ScanRunner";
import { registerDefaultScanners } from "../../scanner/register-scanners";
import { DEFAULT_SETTINGS, type InspectorSettings } from "../../settings/settings";
import type { Issue, ScanResult } from "../../scanner/Issue";

/**
 * All fixture mtimes are pinned so time-dependent scanner behavior (the
 * 7-day orphan recency window) is deterministic in every test run.
 */
export const FIXTURE_PAST_MTIME = Date.UTC(2020, 0, 1);

export type FixtureVaultOptions = {
	settings?: Partial<InspectorSettings>;
	mtimeOverrides?: Record<string, number>;
	requestUrl?: (url: string, signal?: AbortSignal) => Promise<number>;
};

export type FixtureVaultScan = {
	root: string;
	settings: InspectorSettings;
	result: ScanResult;
	issues: Issue[];
};

export function fixtureVaultRoot(): string {
	return fileURLToPath(new URL("../fixtures/precision-vault", import.meta.url));
}

export async function scanFixtureVault(
	options: FixtureVaultOptions = {},
): Promise<FixtureVaultScan> {
	const app = await createLocalApp(fixtureVaultRoot());
	const mtimeOverrides = options.mtimeOverrides ?? {};
	for (const file of app.vault.getFiles()) {
		const stat = file.stat as { ctime: number; mtime: number };
		stat.ctime = FIXTURE_PAST_MTIME;
		stat.mtime = mtimeOverrides[file.path] ?? FIXTURE_PAST_MTIME;
	}
	const settings: InspectorSettings = {
		...structuredClone(DEFAULT_SETTINGS),
		...options.settings,
	};
	const scanRunner = new ScanRunner(options.requestUrl, {
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (timeoutId) =>
			clearTimeout(timeoutId as ReturnType<typeof setTimeout>),
	});
	registerDefaultScanners(scanRunner);
	const result = await scanRunner.run(app, settings);
	return { root: fixtureVaultRoot(), settings, result, issues: result.issues };
}
```

- [ ] **Step 4: Run the smoke test and confirm it passes**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS (1 test). If `filesScanned` is not 31, a fixture file is missing or an extra file (e.g. `.DS_Store`) was created — remove stray files and re-run.

---

### Task 3: Broken-links and orphan-attachment precision assertions

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

- [ ] **Step 1: Add the broken-links block**

Append inside `describe("precision fixture vault", ...)` (add to the top-of-file imports: `import type { Issue } from "../scanner/Issue";`):

```typescript
	describe("broken links", () => {
		it("reports nothing for the valid-links note", async () => {
			const { issues } = await scanFixtureVault();
			const fromValid = issues.filter(
				(issue) => issue.primaryPath === "notes/hub/valid-links.md",
			);
			expect(fromValid).toEqual([]);
		});

		it("reports nothing for the relative-and-unicode note", async () => {
			const { issues } = await scanFixtureVault();
			const fromUnicode = issues.filter(
				(issue) => issue.primaryPath === "notes/hub/relative-and-unicode.md",
			);
			expect(fromUnicode).toEqual([]);
		});

		it("reports five findings for the broken-links note with current fix availability", async () => {
			const { issues } = await scanFixtureVault();
			const broken = issues.filter(
				(issue) =>
					issue.scannerId === "broken-links" &&
					issue.primaryPath === "notes/hub/broken-links.md",
			);
			expect(broken).toHaveLength(5);
			expect(broken.every((issue) => issue.classification === "confirmed")).toBe(true);

			const byMessage = new Map(broken.map((issue) => [issue.message, issue]));
			expect(byMessage.get("Linked file not found: Missing Note")).toMatchObject({
				severity: "error",
				evidence: { link: "Missing Note", target: "Missing Note" },
				fixAction: { kind: "remove-link-text", linkText: "Missing Note" },
			});
			// Markdown links currently get no fix action — Milestone 1.5 target.
			expect(byMessage.get("Linked file not found: missing-target.md")).toMatchObject({
				severity: "error",
				fixAction: undefined,
			});
			expect(byMessage.get("Attachment not found: missing-photo.png")).toMatchObject({
				severity: "error",
				fixAction: { kind: "remove-link-text" },
			});
			expect(byMessage.get("Attachment not found: missing-embed.png")).toMatchObject({
				severity: "error",
				fixAction: { kind: "remove-link-text" },
			});
			expect(
				byMessage.get('Heading "#Missing Heading" not found in notes/target.md'),
			).toMatchObject({
				severity: "warning",
				relatedPaths: ["notes/target.md"],
				fixAction: { kind: "remove-link-text", linkText: "Target#Missing Heading" },
			});
		});
	});
```

- [ ] **Step 2: Add the orphan-attachments block**

```typescript
	describe("orphan attachments", () => {
		const scanOrphans = () =>
			scanFixtureVault({
				mtimeOverrides: {
					"attachments/recent-orphan.png": Date.now() - 60_000,
				},
			}).then(({ issues }) =>
				issues.filter((issue) => issue.scannerId === "orphan-attachments"),
			);

		it("reports exactly the three unreferenced attachments as candidates", async () => {
			const orphans = await scanOrphans();
			expect(orphans).toHaveLength(3);
			expect(orphans.every((issue) => issue.classification === "candidate")).toBe(true);
			expect(orphans.every((issue) => issue.fixAction?.kind === "trash-file")).toBe(true);
			expect(orphans.map((issue) => issue.primaryPath).sort()).toEqual([
				"attachments/canvas-image.png",
				"attachments/orphan.png",
				"attachments/recent-orphan.png",
			]);
		});

		it("keeps the Canvas-only reference as an orphan — known false positive boundary", async () => {
			const orphans = await scanOrphans();
			const canvasOrphan = orphans.find(
				(issue) => issue.primaryPath === "attachments/canvas-image.png",
			);
			// Canvas references are outside the current scan boundary (Milestone 1 target).
			expect(canvasOrphan?.severity).toBe("warning");
			expect(canvasOrphan?.explanation.caveat).toContain("Canvas");
		});

		it("downgrades the recently modified orphan to info severity", async () => {
			const orphans = await scanOrphans();
			const recent = orphans.find(
				(issue) => issue.primaryPath === "attachments/recent-orphan.png",
			);
			expect(recent?.severity).toBe("info");
		});

		it("does not report Markdown, frontmatter, or Unicode referenced attachments", async () => {
			const orphans = await scanOrphans();
			const referenced = [
				"attachments/photo.jpg",
				"attachments/frontmatter-doc.pdf",
				"attachments/目标图片.png",
			];
			expect(
				orphans.some((issue) => referenced.includes(issue.primaryPath ?? "")),
			).toBe(false);
		});
	});
```

- [ ] **Step 3: Run and reconcile**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS. Apply the reconciliation rule from the ground rules for any mismatch.

---

### Task 4: Empty-notes and duplicate-files precision assertions

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

- [ ] **Step 1: Add the empty-notes block**

```typescript
	describe("empty notes", () => {
		it("reports the eight stub notes as warning candidates with trash actions", async () => {
			const { issues } = await scanFixtureVault();
			const empty = issues.filter((issue) => issue.scannerId === "empty-notes");
			expect(empty.map((issue) => issue.primaryPath).sort()).toEqual([
				"notes/empty/cjk-stub.md",
				"notes/empty/embed-only.md",
				"notes/empty/frontmatter-only.md",
				"notes/empty/genuine-empty.md",
				"notes/empty/short-link-moc.md",
				"notes/empty/stub.md",
				"notes/empty/task-note.md",
				"notes/empty/title-only.md",
			]);
			expect(empty.every((issue) => issue.severity === "warning")).toBe(true);
			expect(empty.every((issue) => issue.classification === "candidate")).toBe(true);
			expect(empty.every((issue) => issue.fixAction?.kind === "trash-file")).toBe(true);
		});

		it("keeps structural notes out of the findings — MOC, code note pass today", async () => {
			const { issues } = await scanFixtureVault();
			const emptyPaths = issues
				.filter((issue) => issue.scannerId === "empty-notes")
				.map((issue) => issue.primaryPath);
			expect(emptyPaths).not.toContain("notes/empty/link-only-moc.md");
			expect(emptyPaths).not.toContain("notes/empty/code-note.md");
		});

		it("pins the known false positives with their word counts", async () => {
			const { issues } = await scanFixtureVault();
			const wordCountByPath = new Map(
				issues
					.filter((issue) => issue.scannerId === "empty-notes")
					.map((issue) => [issue.primaryPath, issue.evidence.wordCount]),
			);
			// Link-only, embed-only, and task-only notes are reported today
			// purely by prose word count (Milestone 1.4 target).
			expect(wordCountByPath.get("notes/empty/short-link-moc.md")).toBe(2);
			expect(wordCountByPath.get("notes/empty/embed-only.md")).toBe(1);
			expect(wordCountByPath.get("notes/empty/task-note.md")).toBe(5);
			expect(wordCountByPath.get("notes/empty/cjk-stub.md")).toBe(2);
			expect(wordCountByPath.get("notes/empty/stub.md")).toBe(3);
		});
	});
```

- [ ] **Step 2: Add the duplicate-files block**

```typescript
	describe("duplicate files", () => {
		it("confirms the hash-identical pair and keeps the lexicographically first path", async () => {
			const { issues } = await scanFixtureVault();
			const hashIssues = issues.filter(
				(issue) => issue.title === "Duplicate files (hash-identical)",
			);
			expect(hashIssues).toHaveLength(1);
			const issue = hashIssues[0];
			expect(issue.severity).toBe("warning");
			expect(issue.classification).toBe("confirmed");
			expect([...issue.relatedPaths].sort()).toEqual([
				"duplicates/backup/fixture-data.bin",
				"duplicates/original/fixture-data.bin",
			]);
			expect(issue.fixAction).toMatchObject({
				kind: "trash-file",
				targetPaths: ["duplicates/original/fixture-data.bin"],
				selection: {
					kind: "keep-one",
					automaticKeepPath: "duplicates/backup/fixture-data.bin",
				},
			});
		});

		it("reports same-name and same-size pairs as info candidates without fix actions", async () => {
			const { issues } = await scanFixtureVault();
			const candidates = issues.filter(
				(issue) =>
					issue.scannerId === "duplicate-files" &&
					issue.classification === "candidate",
			);
			expect(candidates).toHaveLength(2);
			expect(candidates.every((issue) => issue.severity === "info")).toBe(true);
			expect(candidates.every((issue) => issue.fixAction === undefined)).toBe(true);
			expect(candidates.map((issue) => issue.message).sort()).toEqual([
				`2 files share the name "notes-a.txt"`,
				"2 files share size 48 B",
			]);
		});
	});
```

- [ ] **Step 3: Run and reconcile**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS.

---

### Task 5: Exact inventory snapshot and fingerprint stability

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

- [ ] **Step 1: Add shared helpers and the inventory test**

At the top of the file after imports, add:

```typescript
type InventoryLine = string;

function inventoryLine(issue: Issue): InventoryLine {
	return [
		issue.scannerId,
		issue.severity,
		issue.classification,
		[issue.primaryPath ?? "", ...issue.relatedPaths].sort().join(","),
		issue.message,
	].join(" | ");
}

function inventoryOf(issues: Issue[]): InventoryLine[] {
	return issues.map(inventoryLine).sort();
}

const EXPECTED_INVENTORY: InventoryLine[] = [
	"broken-links | error | confirmed | Missing Note,notes/hub/broken-links.md | Linked file not found: Missing Note",
	"broken-links | error | confirmed | missing-target.md,notes/hub/broken-links.md | Linked file not found: missing-target.md",
	"broken-links | error | confirmed | missing-photo.png,notes/hub/broken-links.md | Attachment not found: missing-photo.png",
	"broken-links | error | confirmed | missing-embed.png,notes/hub/broken-links.md | Attachment not found: missing-embed.png",
	"broken-links | warning | confirmed | notes/hub/broken-links.md,notes/target.md | Heading \"#Missing Heading\" not found in notes/target.md",
	"orphan-attachments | warning | candidate | attachments/canvas-image.png | This attachment is not referenced by any note",
	"orphan-attachments | warning | candidate | attachments/orphan.png | This attachment is not referenced by any note",
	"orphan-attachments | info | candidate | attachments/recent-orphan.png | This attachment is not referenced by any note",
	"empty-notes | warning | candidate | notes/empty/cjk-stub.md | This note only has 2 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/embed-only.md | This note only has 1 word (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/frontmatter-only.md | This note has no content besides a title",
	"empty-notes | warning | candidate | notes/empty/genuine-empty.md | This note has no content besides a title",
	"empty-notes | warning | candidate | notes/empty/short-link-moc.md | This note only has 2 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/stub.md | This note only has 3 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/task-note.md | This note only has 5 words (likely a stub)",
	"empty-notes | warning | candidate | notes/empty/title-only.md | This note has no content besides a title",
	"duplicate-files | warning | confirmed | duplicates/backup/fixture-data.bin,duplicates/original/fixture-data.bin | 2 files have identical content",
	"duplicate-files | info | candidate | duplicates/archive/notes-a.txt,duplicates/notes-a.txt | 2 files share the name \"notes-a.txt\"",
	"duplicate-files | info | candidate | duplicates/size-twin-one.bin,duplicates/size-twin-two.bin | 2 files share size 48 B",
];
```

Then append the test block:

```typescript
	describe("inventory snapshot", () => {
		it("matches the documented v0.6.0 findings exactly", async () => {
			const { issues } = await scanFixtureVault({
				mtimeOverrides: {
					"attachments/recent-orphan.png": Date.now() - 60_000,
				},
			});
			expect(inventoryOf(issues)).toEqual([...EXPECTED_INVENTORY].sort());
		});

		it("produces identical findings and fingerprints on a repeat scan", async () => {
			const options = {
				mtimeOverrides: {
					"attachments/recent-orphan.png": Date.now() - 60_000,
				},
			};
			const first = await scanFixtureVault(options);
			const second = await scanFixtureVault(options);
			expect(inventoryOf(second.issues)).toEqual(inventoryOf(first.issues));
			expect(
				second.issues.map((issue) => `${issue.fingerprint}:${issue.evidence.lastModified ?? ""}`),
			).toEqual(
				first.issues.map((issue) => `${issue.fingerprint}:${issue.evidence.lastModified ?? ""}`),
			);
		});
	});
```

Note: the snapshot uses the same `recent-orphan.png` mtime override as the orphan block so severity stays deterministic; the fingerprint check pairs each fingerprint with its time-derived evidence to prove both are stable.

- [ ] **Step 2: Run and reconcile**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS. A diff here usually means: (a) an unintended duplicate size collision (re-run the Task 1 audit), (b) a fixture typo changing a message, or (c) a wrong expectation — resolve via the reconciliation rule before proceeding.

---

### Task 6: External-links pass with injected request adapter

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

- [ ] **Step 1: Add the external block**

```typescript
	describe("external links", () => {
		const EXTERNAL_STATUS_BY_URL: Record<string, number> = {
			"https://status-200.example.com/ok": 200,
			"https://status-404.example.com/gone": 404,
			"https://status-403.example.com/private": 403,
			"https://status-429.example.com/slow-down": 429,
			"https://status-500.example.com/server-error": 500,
		};

		const stubRequestUrl = async (url: string): Promise<number> => {
			if (url === "https://request-error.example.com/network-failure") {
				throw new Error("simulated network failure");
			}
			const status = EXTERNAL_STATUS_BY_URL[url];
			if (status === undefined) {
				throw new Error(`unexpected URL in external fixture: ${url}`);
			}
			return status;
		};

		const externalScan = () =>
			scanFixtureVault({
				requestUrl: stubRequestUrl,
				settings: {
					enabledScanners: {
						...DEFAULT_SETTINGS.enabledScanners,
						"external-links": true,
					},
				},
			}).then(({ issues }) =>
				issues.filter((issue) => issue.scannerId === "external-links"),
			);

		it("presents every >= 400 status as the same dead-link candidate — Milestone 1.6 target", async () => {
			const external = await externalScan();
			const dead = external.filter((issue) => issue.title === "Dead external link");
			expect(dead).toHaveLength(4);
			expect(dead.every((issue) => issue.severity === "warning")).toBe(true);
			expect(dead.every((issue) => issue.classification === "candidate")).toBe(true);
			expect(dead.map((issue) => issue.evidence.status).sort()).toEqual([403, 404, 429, 500]);
			expect(dead.every((issue) => issue.primaryPath === "notes/external-links.md")).toBe(true);
		});

		it("stays silent for the healthy URL", async () => {
			const external = await externalScan();
			expect(
				external.some(
					(issue) => issue.evidence.url === "https://status-200.example.com/ok",
				),
			).toBe(false);
		});

		it("marks request failures and blocked destinations as unverified", async () => {
			const external = await externalScan();
			const unverified = external.filter(
				(issue) => issue.classification === "unverified",
			);
			expect(unverified).toHaveLength(2);
			expect(unverified.every((issue) => issue.severity === "info")).toBe(true);
			const failed = unverified.find(
				(issue) => issue.evidence.url === "https://request-error.example.com/network-failure",
			);
			expect(failed?.title).toBe("External link check failed");
			const blocked = unverified.find(
				(issue) => issue.evidence.url === "http://127.0.0.1:9/internal-service",
			);
			expect(blocked?.title).toBe("External link check blocked");
			expect(blocked?.evidence.blocked).toBe(true);
		});
	});
```

Add `DEFAULT_SETTINGS` to the imports at the top: `import { DEFAULT_SETTINGS } from "../settings/settings";`.

- [ ] **Step 2: Run and reconcile**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS. This block must not touch the network — every URL resolves through `stubRequestUrl`, and an unexpected URL fails the scan loudly.

---

### Task 7: Hash-cap pass, then commit the precision work

**Files:**
- Modify: `src/tests/scanner-precision.test.ts`

- [ ] **Step 1: Add the hash-cap block**

```typescript
	describe("duplicate hash cap", () => {
		it("degrades the hash pair to a same-name candidate when below-cap hashing is impossible", async () => {
			const { issues } = await scanFixtureVault({
				settings: { duplicateHashMaxBytes: 8 },
			});
			const duplicates = issues.filter(
				(issue) => issue.scannerId === "duplicate-files",
			);
			expect(
				duplicates.some(
					(issue) => issue.title === "Duplicate files (hash-identical)",
				),
			).toBe(false);
			const capped = duplicates.find(
				(issue) => issue.message === `2 files share the name "fixture-data.bin"`,
			);
			expect(capped).toMatchObject({
				severity: "info",
				classification: "candidate",
				fixAction: undefined,
			});
			expect([...capped?.relatedPaths ?? []].sort()).toEqual([
				"duplicates/backup/fixture-data.bin",
				"duplicates/original/fixture-data.bin",
			]);
			// The other two candidate groups are unaffected by the cap.
			expect(duplicates).toHaveLength(3);
			expect(duplicates.every((issue) => issue.severity === "info")).toBe(true);
		});
	});
```

- [ ] **Step 2: Run the whole precision suite**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: PASS (16 tests: 1 smoke + 2 valid-link negatives + 1 broken-links + 4 orphan + 3 empty + 2 duplicate + 2 inventory + 3 external + 1 hash-cap — the exact count may differ by block splits; every test green is what matters).

- [ ] **Step 3: Run the full repository gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all four commands exit 0 with zero warnings/errors and zero failed tests.

- [ ] **Step 4: Commit**

```bash
git add src/tests/fixtures/precision-vault src/tests/helpers/fixture-vault.ts src/tests/scanner-precision.test.ts
git commit -m "test: add scanner precision fixture vault"
```

---

### Task 8: Synthetic vault generator and CI performance test

**Files:**
- Create: `src/tests/helpers/synthetic-vault.ts`
- Create: `src/tests/scan-performance.test.ts`

- [ ] **Step 1: Write the failing performance test**

Create `src/tests/scan-performance.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createLocalApp } from "../cli/local-vault";
import { ScanRunner } from "../scanner/ScanRunner";
import { registerDefaultScanners } from "../scanner/register-scanners";
import { DEFAULT_SETTINGS } from "../settings/settings";
import { generateSyntheticVault } from "./helpers/synthetic-vault";

describe("scan performance baseline", () => {
	it(
		"scans a synthetic vault without external links well inside the regression bound",
		async () => {
			const vaultDir = await mkdtemp(join(tmpdir(), "vault-inspector-perf-"));
			try {
				const generated = await generateSyntheticVault(vaultDir, {
					notes: 120,
					attachments: 40,
				});
				const app = await createLocalApp(vaultDir);
				const scanRunner = new ScanRunner();
				registerDefaultScanners(scanRunner);
				const settings = structuredClone(DEFAULT_SETTINGS);

				const startedAt = performance.now();
				const result = await scanRunner.run(app, settings);
				const durationMs = performance.now() - startedAt;

				expect(result.filesScanned).toBe(
					generated.markdownFiles + generated.attachmentFiles,
				);
				expect(result.scannersRun).not.toContain("external-links");
				expect(result.issues.length).toBeGreaterThan(0);
				expect(durationMs).toBeLessThan(30_000);
			} finally {
				await rm(vaultDir, { recursive: true, force: true });
			}
		},
		120_000,
	);
});
```

Note the import path difference from the plan's earlier files: this test lives at `src/tests/`, so `../cli/local-vault` and `../scanner/...` are correct here.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npm test -- src/tests/scan-performance.test.ts
```

Expected: FAIL — cannot resolve `./helpers/synthetic-vault`.

- [ ] **Step 3: Implement the generator**

Create `src/tests/helpers/synthetic-vault.ts`:

```typescript
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SyntheticVaultSpec = {
	notes: number;
	attachments: number;
	seed?: number;
};

export type SyntheticVaultResult = {
	markdownFiles: number;
	attachmentFiles: number;
};

const SENTENCES = [
	"This sentence exists to give the note realistic prose volume.",
	"Deterministic filler keeps the generator reproducible from a fixed seed.",
	"Synthetic content stands in for a real vault without any user data.",
	"Repeated prose is fine because scanners only measure structure.",
];

const FIXED_MTIME = new Date(Date.UTC(2020, 0, 1));

export async function generateSyntheticVault(
	vaultDir: string,
	spec: SyntheticVaultSpec,
): Promise<SyntheticVaultResult> {
	const seed = spec.seed ?? 20260829;
	let state = seed >>> 0;
	const nextRandom = (): number => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return state / 0x100000000;
	};
	const randomInt = (min: number, max: number): number =>
		min + Math.floor(nextRandom() * (max - min + 1));

	const notePaths = Array.from(
		{ length: spec.notes },
		(_, index) => `notes/note-${String(index + 1).padStart(4, "0")}.md`,
	);
	const attachmentPaths = Array.from(
		{ length: spec.attachments },
		(_, index) => `attachments/asset-${String(index + 1).padStart(4, "0")}.png`,
	);

	for (let index = 0; index < notePaths.length; index++) {
		const lines: string[] = [
			`# Synthetic Note ${index + 1}`,
			"",
			`Deterministic prose paragraph for ${notePaths[index]}.`,
			SENTENCES[index % SENTENCES.length],
			"",
		];
		const linkCount = randomInt(1, 3);
		for (let link = 0; link < linkCount; link++) {
			const target = randomInt(1, spec.notes);
			lines.push(`- Related note: [[note-${String(target).padStart(4, "0")}]]`);
		}
		if (nextRandom() < 0.3) {
			lines.push(`- Stale link: [[missing-note-${randomInt(1, 999)}]]`);
		}
		if (spec.attachments > 0 && nextRandom() < 0.25) {
			const asset = randomInt(1, spec.attachments);
			lines.push(`- Attachment: ![[asset-${String(asset).padStart(4, "0")}.png]]`);
		}
		if (nextRandom() < 0.15) {
			const target = randomInt(1, spec.notes);
			lines.push(`- Cross reference: [see also](../notes/note-${String(target).padStart(4, "0")}.md)`);
		}
		await writePinned(join(vaultDir, notePaths[index]), `${lines.join("\n")}\n`);
	}

	for (let index = 0; index < attachmentPaths.length; index++) {
		const size = 1024 + ((index * 257) % 8192);
		const body = `synthetic-asset-${index + 1}: `.padEnd(size, "x");
		await writePinned(join(vaultDir, attachmentPaths[index]), body);
	}

	const duplicatePayload = "synthetic duplicate payload ".padEnd(2048, "d");
	await writePinned(
		join(vaultDir, "duplicates/copy-a/synthetic-report.bin"),
		duplicatePayload,
	);
	await writePinned(
		join(vaultDir, "duplicates/copy-b/synthetic-report.bin"),
		duplicatePayload,
	);

	return {
		markdownFiles: notePaths.length,
		attachmentFiles: attachmentPaths.length + 2,
	};
}

async function writePinned(absolutePath: string, content: string): Promise<void> {
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, content, "utf8");
	await utimes(absolutePath, FIXED_MTIME, FIXED_MTIME);
}
```

- [ ] **Step 4: Run the performance test and sanity-check the duration**

```bash
npm test -- src/tests/scan-performance.test.ts
```

Expected: PASS in well under 5 seconds of scan time locally (a 160-file vault scans in the hundreds of milliseconds). If the local duration exceeds 5 seconds, investigate before proceeding — do not raise the 30-second bound; the bound is generous for CI, not a target.

- [ ] **Step 5: Prove determinism**

```bash
npm test -- src/tests/scan-performance.test.ts && npm test -- src/tests/scan-performance.test.ts
```

Expected: two identical runs (same pass result). For stronger evidence during implementation, temporarily log `result.issues.length` once and confirm the same number on both runs, then remove the log line.

---

### Task 9: Benchmark script and npm wiring

**Files:**
- Create: `scripts/benchmark-scan.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the benchmark script**

Create `scripts/benchmark-scan.mjs`:

```javascript
#!/usr/bin/env node
// Deterministic, non-network scan benchmark for Vault Inspector.
//
// Bundles the TypeScript sources with the existing esbuild devDependency so a
// plain Node 18+ process can import them, generates a synthetic vault in a
// temp directory, and reports median scan timing plus read counters.
//
// Usage:
//   npm run benchmark:scan [-- --notes 400 --attachments 150 --runs 3 --json --keep]

import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(argv) {
	const options = { notes: 400, attachments: 150, runs: 3, json: false, keep: false };
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (flag === "--notes") { options.notes = Number(value); index++; }
		else if (flag === "--attachments") { options.attachments = Number(value); index++; }
		else if (flag === "--runs") { options.runs = Number(value); index++; }
		else if (flag === "--json") { options.json = true; }
		else if (flag === "--keep") { options.keep = true; }
		else {
			console.error(`Unknown argument: ${flag}`);
			process.exit(2);
		}
	}
	return options;
}

const ENTRY_SOURCE = `
export { createLocalApp } from "./cli/local-vault";
export { ScanRunner } from "./src/scanner/ScanRunner";
export { registerDefaultScanners } from "./src/scanner/register-scanners";
export { DEFAULT_SETTINGS } from "./src/settings/settings";
export { generateSyntheticVault } from "./src/tests/helpers/synthetic-vault";
`;

async function loadBundledExports() {
	const bundleDir = await mkdtemp(join(tmpdir(), "vault-inspector-benchmark-"));
	const bundlePath = join(bundleDir, "benchmark-bundle.mjs");
	await build({
		stdin: {
			contents: ENTRY_SOURCE,
			resolveDir: repoRoot,
			sourcefile: "benchmark-entry.ts",
			loader: "ts",
		},
		bundle: true,
		platform: "node",
		format: "esm",
		outfile: bundlePath,
		logLevel: "silent",
		external: ["obsidian"],
	});
	try {
		return await import(pathToFileURL(bundlePath).href);
	} finally {
		await rm(bundleDir, { recursive: true, force: true });
	}
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

const options = parseArgs(process.argv.slice(2));
const { createLocalApp, ScanRunner, registerDefaultScanners, DEFAULT_SETTINGS, generateSyntheticVault } =
	await loadBundledExports();

const vaultDir = await mkdtemp(join(tmpdir(), "vault-inspector-benchmark-vault-"));
try {
	const generated = await generateSyntheticVault(vaultDir, {
		notes: options.notes,
		attachments: options.attachments,
	});

	const scanDurations = [];
	const loadDurations = [];
	let lastResult = null;
	let hashReads = 0;
	let contentReads = 0;

	for (let run = 1; run <= options.runs; run++) {
		hashReads = 0;
		contentReads = 0;
		const loadStartedAt = performance.now();
		const app = await createLocalApp(vaultDir);
		const originalReadBinary = app.vault.readBinary.bind(app.vault);
		const originalCachedRead = app.vault.cachedRead.bind(app.vault);
		app.vault.readBinary = async (file) => {
			hashReads++;
			return originalReadBinary(file);
		};
		app.vault.cachedRead = async (file) => {
			contentReads++;
			return originalCachedRead(file);
		};
		loadDurations.push(performance.now() - loadStartedAt);

		const scanRunner = new ScanRunner();
		registerDefaultScanners(scanRunner);
		const settings = structuredClone(DEFAULT_SETTINGS);
		const scanStartedAt = performance.now();
		lastResult = await scanRunner.run(app, settings);
		scanDurations.push(performance.now() - scanStartedAt);
	}

	const issuesByScanner = {};
	for (const issue of lastResult.issues) {
		issuesByScanner[issue.scannerId] = (issuesByScanner[issue.scannerId] ?? 0) + 1;
	}
	const medianScanMs = Math.round(median(scanDurations));
	const medianLoadMs = Math.round(median(loadDurations));
	const summary =
		`benchmark:scan | ${lastResult.filesScanned} files | ${lastResult.issues.length} issues | ` +
		`${medianScanMs}ms median scan | ${hashReads} hash reads`;

	if (options.json) {
		console.log(
			JSON.stringify(
				{
					files: lastResult.filesScanned,
					markdownFiles: generated.markdownFiles,
					attachmentFiles: generated.attachmentFiles,
					issues: lastResult.issues.length,
					issuesByScanner,
					runs: options.runs,
					scanMsPerRun: scanDurations.map((value) => Math.round(value)),
					medianScanMs,
					medianLoadMs,
					hashReads,
					contentReads,
					scannersRun: lastResult.scannersRun,
				},
				null,
				2,
			),
		);
	} else {
		console.log("vault-inspector scan benchmark");
		console.log(`  vault:            ${lastResult.filesScanned} files (${generated.markdownFiles} markdown, ${generated.attachmentFiles} attachments)`);
		console.log(`  scanners:         ${lastResult.scannersRun.length} (external-links disabled)`);
		console.log(`  runs:             ${options.runs}`);
		console.log(`  adapter load:     ${medianLoadMs} ms (median)`);
		console.log(`  scan:             ${medianScanMs} ms (median; runs: ${scanDurations.map((value) => Math.round(value)).join(", ")})`);
		console.log(`  issues:           ${lastResult.issues.length} total`);
		for (const [scannerId, count] of Object.entries(issuesByScanner).sort()) {
			console.log(`    ${scannerId.padEnd(20)} ${count}`);
		}
		console.log(`  files read for hashing: ${hashReads}`);
		console.log(`  content reads:          ${contentReads}`);
		console.log(summary);
	}
	if (options.keep) {
		console.error(`kept vault at ${vaultDir}`);
	} else {
		await rm(vaultDir, { recursive: true, force: true });
	}
} catch (error) {
	await rm(vaultDir, { recursive: true, force: true }).catch(() => {});
	throw error;
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add one line to `scripts` (after `"test:coverage"`):

```json
		"benchmark:scan": "node scripts/benchmark-scan.mjs",
```

- [ ] **Step 3: Run the benchmark and record the baseline**

```bash
npm run benchmark:scan
```

Expected: exit 0, a table ending with a one-line `benchmark:scan | ...` summary. Record that summary line verbatim in the PR description — it is the Milestone 0 baseline that Milestone 1's reference-index work must stay within 15% of. Also run the JSON mode once to confirm it parses:

```bash
npm run benchmark:scan -- --json --runs 1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s);console.log('json ok')})"
```

Expected: `json ok`.

- [ ] **Step 4: Confirm determinism across two benchmark runs**

```bash
npm run benchmark:scan -- --runs 3 > /tmp/bench-first.txt && npm run benchmark:scan -- --runs 3 > /tmp/bench-second.txt && diff <(grep -E 'files \||issues:' /tmp/bench-first.txt) <(grep -E 'files \||issues:' /tmp/bench-second.txt)
```

Expected: no diff — file and issue counts are identical across runs (timings may vary; counts must not).

---

### Task 10: Full verification and PR

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Run every repository gate**

```bash
npm run lint
npm run lint:obsidian-warnings
npm run build
npm test
npm pack --dry-run
node cli.js --help
```

Expected: all exit 0; ESLint zero warnings; vitest zero failures; the pack listing contains only `main.js`, `cli.js`, `manifest.json`, `styles.css`, `versions.json`, `README.md`, `LICENSE` (the new `scripts/` and fixture files must NOT be packaged); `--help` prints usage.

- [ ] **Step 2: Confirm no production file changed**

```bash
git diff --stat main -- src/scanner src/report src/fix src/settings src/main.ts src/utils cli
```

Expected: empty output (no diffs outside `src/tests/`, `scripts/`, and `package.json`).

- [ ] **Step 3: Commit the performance baseline**

```bash
git add src/tests/helpers/synthetic-vault.ts src/tests/scan-performance.test.ts scripts/benchmark-scan.mjs package.json
git commit -m "test: add repeatable scan performance baseline"
```

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/scanner-precision-foundation
```

Open the PR against `main` with title `test: add scanner precision fixture vault and scan performance baseline`. The description must include (per the roadmap's PR requirements):

- product behavior changed: none — tests and tooling only;
- non-goals: no scanner fixes; Canvas orphan, short MOC, embed-only, task-note false positives and 403/429/500 dead-link presentation are intentionally pinned as current behavior;
- focused tests run: the exact `npm test -- ...` lines from Tasks 2–9;
- full verification results: the Task 10 gate outputs;
- migration/compatibility impact: none (no schema, settings, or CLI output changes);
- manual validation performed: the Task 1 size audit, the Task 9 determinism check, and the recorded `benchmark:scan` baseline summary line;
- remaining detection boundaries: Canvas references, CSS/Dataview/publishing references, Markdown-link fix actions, external-link status classes.

## Self-review checklist (completed during plan writing)

- Every roadmap Milestone 0 requirement maps to a task: fixture note types → Task 1 Steps 2–5; attachment reference channels → Steps 2, 5, 6; duplicate groups (hash-identical, same-name, same-size, above cap) → Step 6 + Task 7; empty-note structures → Step 4; external links via injected adapters → Task 6; shared loader for plugin/CLI tests → Task 2; per-case finding assertions (severity, classification, evidence, actions, fingerprint stability) → Tasks 3–6; deterministic generator → Task 8; non-network benchmark + npm script + generous CI gate + local 15% gate → Tasks 8–9; reproducible-from-clean-checkout → Task 9 Step 4.
- `scripts/benchmark-scan.mjs` is `.mjs` and `src/tests/**` is eslint-ignored, so no lint rules apply to the new code; `tsc` covers the two new helpers via the existing `include` globs.
- Type names used across tasks (`FixtureVaultOptions`, `FixtureVaultScan`, `SyntheticVaultSpec`, `SyntheticVaultResult`, `FIXTURE_PAST_MTIME`, `scanFixtureVault`, `generateSyntheticVault`) are defined in Task 2/Task 8 and consumed unchanged elsewhere.
