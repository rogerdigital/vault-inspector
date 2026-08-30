# Shared Reference Index Implementation Plan (Milestone 1, Task 1.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one shared reference index per scan — inbound reference counts, source kinds, and source paths per vault path, covering Markdown links, embeds, frontmatter links, and Canvas file nodes — exposed through `ScanContext` for later milestones, with zero scanner behavior change.

**Architecture:** A pure `buildReferenceIndex(ctx)` module resolves references through the same `metadataCache.getFirstLinkpathDest` / `resolveVaultLinkTargets` path the orphan scanner uses today, reads `.canvas` files directly via `vault.cachedRead`, and records malformed Canvas data as structured coverage failures. `ScanRunner` builds it once per scan. No scanner consumes it yet; the precision inventory must stay byte-identical.

**Tech Stack:** TypeScript, Vitest, Obsidian plugin test mocks

Design doc: `docs/superpowers/specs/2026-08-30-reference-index-design.md`
Parent roadmap: `docs/superpowers/plans/2026-08-29-core-maintenance-deepening-roadmap.md` (Milestone 1, Task 1.1)

---

## Ground rules

- Branch: `feat/reference-index`, cut from latest `main` (must include PR #125).
- No detection behavior change: `src/tests/scanner-precision.test.ts` (19-line inventory) must pass UNCHANGED. No fingerprint or version changes.
- Scanner files (`src/scanner/scanners/*`) are NOT modified in this PR. Only new module + `ScanContext.ts` + `ScanRunner.ts` + test helpers/tests.
- Deviation from the roadmap file list: `cli/local-vault.ts` needs no change (design doc explains why).
- One commit: `feat: add shared reference index`.
- Benchmark gate: median scan duration within 15% of the Milestone 0 baseline (`benchmark:scan | 552 files | 246 issues | 59ms median scan | 373 hash reads`).

---

### Task 1: Branch and fixture-context helper

**Files:**
- Modify: `src/tests/helpers/fixture-vault.ts`
- Reference: `src/scanner/ScanRunner.ts:43-72` (context mapping to mirror)

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/reference-index
```

- [ ] **Step 2: Extend the fixture helper**

Refactor `src/tests/helpers/fixture-vault.ts`: extract mtime pinning and add `loadFixtureVaultContext`. The full file becomes:

```typescript
import { fileURLToPath } from "node:url";
import type { App } from "obsidian";
import { createLocalApp } from "../../../cli/local-vault";
import { ScanRunner } from "../../scanner/ScanRunner";
import { registerDefaultScanners } from "../../scanner/register-scanners";
import { makeEmptyReferenceIndex } from "../../scanner/reference-index";
import { DEFAULT_SETTINGS, type InspectorSettings } from "../../settings/settings";
import type { Issue, ScanResult } from "../../scanner/Issue";
import type { ScanContext } from "../../scanner/ScanContext";

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

/**
 * Loads the fixture app and applies deterministic mtimes. Shared by
 * scanFixtureVault and loadFixtureVaultContext.
 */
async function loadPinnedFixtureApp(
	mtimeOverrides: Record<string, number>,
): Promise<App> {
	const app = await createLocalApp(fixtureVaultRoot());
	const matched = new Set<string>();
	for (const file of app.vault.getFiles()) {
		const stat = file.stat as { ctime: number; mtime: number };
		stat.ctime = FIXTURE_PAST_MTIME;
		const override = mtimeOverrides[file.path];
		if (override !== undefined) matched.add(file.path);
		stat.mtime = override ?? FIXTURE_PAST_MTIME;
	}
	const unknown = Object.keys(mtimeOverrides).filter((key) => !matched.has(key));
	if (unknown.length > 0) {
		throw new Error(
			`mtimeOverrides reference unknown fixture paths: ${unknown.join(", ")}`,
		);
	}
	return app;
}

/**
 * Builds a ScanContext over the fixture vault mirroring ScanRunner's field
 * mapping, for tests that exercise context-consuming modules directly
 * (e.g. buildReferenceIndex). The referenceIndex starts empty; callers
 * replace it as needed.
 */
export async function loadFixtureVaultContext(
	options: FixtureVaultOptions = {},
): Promise<{ app: App; ctx: ScanContext }> {
	const app = await loadPinnedFixtureApp(options.mtimeOverrides ?? {});
	const allFiles = app.vault.getFiles();
	const ctx: ScanContext = {
		app,
		metadataCache: app.metadataCache,
		vault: app.vault,
		requestUrl: undefined,
		setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
		clearTimeout: (timeoutId) =>
			clearTimeout(timeoutId as ReturnType<typeof setTimeout>),
		markdownFiles: app.vault.getMarkdownFiles(),
		allFiles,
		filePathIndex: new Set(allFiles.map((file) => file.path)),
		enabledScanners: new Set(),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: DEFAULT_SETTINGS.largeMarkdownBytes,
		largeAttachmentBytes: DEFAULT_SETTINGS.largeAttachmentBytes,
		ignoredLargeMarkdownFrontmatterKeys:
			DEFAULT_SETTINGS.ignoredLargeMarkdownFrontmatterKeys,
		ignoredLargeMarkdownPathPatterns:
			DEFAULT_SETTINGS.ignoredLargeMarkdownPathPatterns,
		duplicateHashMaxBytes: DEFAULT_SETTINGS.duplicateHashMaxBytes,
		lowUsageTagThreshold: DEFAULT_SETTINGS.lowUsageTagThreshold,
		watchedTags: DEFAULT_SETTINGS.watchedTags,
		ignoredFolders: options.settings?.ignoredFolders ?? [],
		ignoreUnresolvedNoteLinks:
			options.settings?.ignoreUnresolvedNoteLinks ??
			DEFAULT_SETTINGS.ignoreUnresolvedNoteLinks,
		ignoredProperties: options.settings?.ignoredProperties ?? [],
		emptyNoteWordThreshold: DEFAULT_SETTINGS.emptyNoteWordThreshold,
		referenceIndex: makeEmptyReferenceIndex(),
	};
	return { app, ctx };
}

export async function scanFixtureVault(
	options: FixtureVaultOptions = {},
): Promise<FixtureVaultScan> {
	const app = await loadPinnedFixtureApp(options.mtimeOverrides ?? {});
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

Note: this step intentionally still compiles BEFORE `reference-index.ts` exists only if the import is added later — instead, implement Task 1 and Task 2 together if you prefer; the plan keeps them separate for review clarity. If you keep them separate, `makeEmptyReferenceIndex` and the `referenceIndex` field will not type-check until Tasks 2–3; run the suite only after Task 3. Practical order: make all edits in Tasks 1–3, then run tests.

- [ ] **Step 3: Verify nothing else broke (after Tasks 2-3 wiring)**

```bash
npm test -- src/tests/scanner-precision.test.ts
```

Expected: 19 passing, unchanged.

---

### Task 2: The reference-index module (TDD)

**Files:**
- Create: `src/scanner/reference-index.ts`
- Create: `src/tests/reference-index.test.ts`
- Modify: `src/tests/helpers/scan-context.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/tests/reference-index.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { ScanContext } from "../scanner/ScanContext";
import {
	buildReferenceIndex,
	getInboundReference,
	isReferenced,
	makeEmptyReferenceIndex,
} from "../scanner/reference-index";
import { makeScanContext, makeTestFile } from "./helpers/scan-context";
import { loadFixtureVaultContext } from "./helpers/fixture-vault";

function canvasContext(canvasFiles: Record<string, string>): ScanContext {
	const canvasEntries = Object.entries(canvasFiles).map(([path, content]) =>
		makeTestFile(path),
	);
	const markdown = makeTestFile("notes/source.md");
	const ctx = makeScanContext({
		scanner: "orphan-attachments",
		files: [markdown, ...canvasEntries],
		metadataByPath: {
			"notes/source.md": { links: [], embeds: [], frontmatterLinks: [] },
		},
		overrides: {
			vault: {
				cachedRead: async (file: { path: string }) => {
					const content = canvasFiles[file.path];
					if (content === undefined) throw new Error("not found");
					return content;
				},
			} as any,
		},
	});
	return ctx;
}

describe("buildReferenceIndex markdown sources", () => {
	it("records inbound count, kinds, and sources for links, embeds, and frontmatter links", async () => {
		const ctx = makeScanContext({
			files: [
				makeTestFile("notes/a.md"),
				makeTestFile("notes/b.md"),
				makeTestFile("assets/used.png"),
			],
			metadataByPath: {
				"notes/a.md": {
					links: [{ link: "assets/used.png" }],
					embeds: [{ link: "assets/used.png" }],
					frontmatterLinks: [{ key: "cover", link: "assets/used.png" }],
				},
				"notes/b.md": {
					links: [{ link: "assets/used.png" }],
					embeds: [],
					frontmatterLinks: [],
				},
			},
		});
		const index = await buildReferenceIndex(ctx);
		const inbound = getInboundReference(index, "assets/used.png");
		expect(inbound).toBeDefined();
		expect(inbound?.count).toBe(4);
		expect(inbound?.kinds).toEqual(["embed", "frontmatter", "note-link"]);
		expect(inbound?.sources).toEqual(["notes/a.md", "notes/b.md"]);
		expect(isReferenced(index, "assets/used.png")).toBe(true);
		expect(isReferenced(index, "notes/a.md")).toBe(false);
	});

	it("skips external URLs and unresolved targets", async () => {
		const ctx = makeScanContext({
			files: [
				makeTestFile("notes/a.md"),
				makeTestFile("assets/used.png"),
			],
			metadataByPath: {
				"notes/a.md": {
					links: [
						{ link: "https://example.com/x" },
						{ link: "missing.png" },
						{ link: "assets/used.png" },
					],
					embeds: [],
					frontmatterLinks: [],
				},
			},
		});
		const index = await buildReferenceIndex(ctx);
		expect(index.inboundByPath.size).toBe(1);
		expect(isReferenced(index, "assets/used.png")).toBe(true);
	});

	it("counts references from notes inside ignored folders", async () => {
		const ctx = makeScanContext({
			files: [
				makeTestFile("templates/source.md"),
				makeTestFile("assets/used.png"),
			],
			metadataByPath: {
				"templates/source.md": {
					links: [{ link: "assets/used.png" }],
					embeds: [],
					frontmatterLinks: [],
				},
			},
			overrides: { ignoredFolders: ["templates"] },
		});
		const index = await buildReferenceIndex(ctx);
		expect(isReferenced(index, "assets/used.png")).toBe(true);
	});

	it("does not mutate vault files", async () => {
		let reads = 0;
		const ctx = makeScanContext({
			files: [makeTestFile("notes/a.md"), makeTestFile("assets/used.png")],
			metadataByPath: {
				"notes/a.md": {
					links: [{ link: "assets/used.png" }],
					embeds: [],
					frontmatterLinks: [],
				},
			},
			overrides: {
				vault: {
					cachedRead: async () => {
						reads++;
						return "";
					},
				} as any,
			},
		});
		await buildReferenceIndex(ctx);
		expect(reads).toBe(0); // no canvas files -> no reads at all
	});
});

describe("buildReferenceIndex canvas sources", () => {
	it("records canvas file-node references with the canvas kind", async () => {
		const ctx = canvasContext({
			"canvas/board.canvas": JSON.stringify({
				nodes: [
					{ id: "n1", type: "file", file: "assets/pic.png" },
					{ id: "n2", type: "text", text: "hello" },
					{ id: "n3", type: "file", file: "notes/a.md" },
				],
				edges: [],
			}),
			"notes/a.md": "# A",
		});
		const png = makeTestFile("assets/pic.png");
		ctx.allFiles = [...ctx.allFiles, png];
		ctx.filePathIndex = new Set([...ctx.filePathIndex, png.path]);
		const index = await buildReferenceIndex(ctx);
		expect(index.canvasFiles).toEqual(["canvas/board.canvas"]);
		expect(index.coverageComplete).toBe(true);
		expect(getInboundReference(index, "assets/pic.png")).toMatchObject({
			count: 1,
			kinds: ["canvas"],
			sources: ["canvas/board.canvas"],
		});
		expect(getInboundReference(index, "notes/a.md")).toMatchObject({
			kinds: ["canvas"],
		});
	});

	it("records malformed canvas JSON as a coverage failure without failing", async () => {
		const ctx = canvasContext({ "canvas/bad.canvas": "{not json" });
		const index = await buildReferenceIndex(ctx);
		expect(index.coverageComplete).toBe(false);
		expect(index.coverageFailures).toEqual([
			{ path: "canvas/bad.canvas", reason: "malformed-json", detail: expect.any(String) },
		]);
	});

	it("records unreadable and non-object canvas files as coverage failures", async () => {
		const ctx = canvasContext({
			"canvas/gone.canvas": "{}",
			"canvas/odd.canvas": "just a string",
		});
		ctx.vault = {
			cachedRead: async (file: { path: string }) => {
				if (file.path === "canvas/gone.canvas") throw new Error("boom");
				return "just a string";
			},
		} as any;
		const index = await buildReferenceIndex(ctx);
		expect(index.coverageComplete).toBe(false);
		const reasons = index.coverageFailures
			.map((failure) => `${failure.path}:${failure.reason}`)
			.sort();
		expect(reasons).toEqual([
			"canvas/gone.canvas:read-failed",
			"canvas/odd.canvas:unexpected-shape",
		]);
	});

	it("handles a batch of canvas files without coverage failures", async () => {
		const files: Record<string, string> = {};
		const extraFiles = [];
		for (let i = 1; i <= 50; i++) {
			files[`canvas/c${i}.canvas`] = JSON.stringify({
				nodes: [{ id: "n", type: "file", file: `assets/a${i}.png` }],
				edges: [],
			});
			extraFiles.push(makeTestFile(`assets/a${i}.png`));
		}
		const ctx = canvasContext(files);
		ctx.allFiles = [...ctx.allFiles, ...extraFiles];
		ctx.filePathIndex = new Set([...ctx.filePathIndex, ...extraFiles.map((f) => f.path)]);
		const index = await buildReferenceIndex(ctx);
		expect(index.coverageComplete).toBe(true);
		expect(index.canvasFiles).toHaveLength(50);
		expect(index.inboundByPath.size).toBe(50);
	});
});

describe("buildReferenceIndex against the precision fixture vault", () => {
	it("sees every documented reference channel", async () => {
		const { ctx } = await loadFixtureVaultContext();
		const index = await buildReferenceIndex(ctx);
		expect(index.coverageComplete).toBe(true);
		expect(index.canvasFiles).toEqual(["canvas/board.canvas"]);
		expect(getInboundReference(index, "attachments/canvas-image.png")).toEqual({
			count: 1,
			kinds: ["canvas"],
			sources: ["canvas/board.canvas"],
		});
		const frontmatter = getInboundReference(index, "attachments/frontmatter-doc.pdf");
		expect(frontmatter?.kinds).toContain("frontmatter");
		const photo = getInboundReference(index, "attachments/photo.jpg");
		expect(photo?.kinds).toEqual(["embed", "note-link"]);
		expect(photo?.sources.sort()).toEqual([
			"notes/attachments-ref.md",
			"notes/hub/valid-links.md",
		]);
		const unicode = getInboundReference(index, "attachments/目标图片.png");
		expect(unicode?.kinds).toEqual(["embed"]);
		expect(isReferenced(index, "attachments/orphan.png")).toBe(false);
		expect(isReferenced(index, "attachments/recent-orphan.png")).toBe(false);
	});

	it("is deterministic across builds", async () => {
		const first = await loadFixtureVaultContext().then(({ ctx }) =>
			buildReferenceIndex(ctx),
		);
		const second = await loadFixtureVaultContext().then(({ ctx }) =>
			buildReferenceIndex(ctx),
		);
		expect([...second.inboundByPath.entries()]).toEqual(
			[...first.inboundByPath.entries()],
		);
		expect(second.coverageComplete).toBe(first.coverageComplete);
	});
});

describe("makeEmptyReferenceIndex", () => {
	it("provides a blank, complete index", () => {
		const index = makeEmptyReferenceIndex();
		expect(index.inboundByPath.size).toBe(0);
		expect(index.coverageComplete).toBe(true);
		expect(isReferenced(index, "anything.png")).toBe(false);
	});
});
```

Note on the fixture test: `photo.jpg` gets one `embed` from `notes/attachments-ref.md`, one `embed` from `notes/hub/valid-links.md` (`![[photo.jpg]]`), and `notes/empty/embed-only.md` also embeds it — so sources include THREE files and count is 3. Verify against real output on first run and adjust the expected `sources`/`count` to reality (the scanner source and fixture files are the ground truth; `notes/empty/embed-only.md` contains `![[photo.jpg]]`).

- [ ] **Step 2: Run and confirm failure**

```bash
npm test -- src/tests/reference-index.test.ts
```

Expected: FAIL — cannot resolve `../scanner/reference-index`.

- [ ] **Step 3: Implement the module**

Create `src/scanner/reference-index.ts`:

```typescript
import type { ScanContext } from "./ScanContext";
import { hasUriScheme, resolveVaultLinkTargets } from "../utils/vault-links";

export type ReferenceSourceKind = "note-link" | "embed" | "frontmatter" | "canvas";

export type ReferenceCoverageFailure = {
	path: string;
	reason: "malformed-json" | "read-failed" | "unexpected-shape";
	detail?: string;
};

export type InboundReference = {
	count: number;
	kinds: ReferenceSourceKind[];
	sources: string[];
};

export type ReferenceIndex = {
	inboundByPath: Map<string, InboundReference>;
	canvasFiles: string[];
	coverageFailures: ReferenceCoverageFailure[];
	coverageComplete: boolean;
};

export function makeEmptyReferenceIndex(): ReferenceIndex {
	return {
		inboundByPath: new Map(),
		canvasFiles: [],
		coverageFailures: [],
		coverageComplete: true,
	};
}

export function getInboundReference(
	index: ReferenceIndex,
	path: string,
): InboundReference | undefined {
	return index.inboundByPath.get(path);
}

export function isReferenced(index: ReferenceIndex, path: string): boolean {
	return index.inboundByPath.has(path);
}

type CanvasNode = {
	type?: unknown;
	file?: unknown;
};

/**
 * Builds the shared reference index: which vault paths are referenced, how
 * often, through which source kinds (note links, embeds, frontmatter links,
 * Canvas file nodes), from which source files.
 *
 * Malformed or unreadable Canvas files are recorded as coverage failures and
 * mark the index incomplete; they never abort the scan. Consumers must treat
 * "no inbound references" as candidate evidence only while coverage is
 * incomplete, and must remember that CSS, Dataview, publishing pipelines,
 * and external applications can reference files outside this index.
 */
export async function buildReferenceIndex(ctx: ScanContext): Promise<ReferenceIndex> {
	const inboundByPath = new Map<string, InboundReference>();
	const coverageFailures: ReferenceCoverageFailure[] = [];
	const canvasFiles: string[] = [];

	const addReference = (
		targetPath: string,
		sourcePath: string,
		kind: ReferenceSourceKind,
	): void => {
		const entry =
			inboundByPath.get(targetPath) ?? { count: 0, kinds: [], sources: [] };
		entry.count += 1;
		if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
		if (!entry.sources.includes(sourcePath)) entry.sources.push(sourcePath);
		inboundByPath.set(targetPath, entry);
	};

	const resolveTarget = (link: string, sourcePath: string): string | null => {
		if (!link || hasUriScheme(link)) return null;
		if (typeof ctx.metadataCache.getFirstLinkpathDest === "function") {
			return ctx.metadataCache.getFirstLinkpathDest(link, sourcePath)?.path ?? null;
		}
		return resolveVaultLinkTargets(ctx, link, sourcePath)[0] ?? null;
	};

	for (const file of ctx.markdownFiles) {
		const cache = ctx.metadataCache.getFileCache(file);
		if (!cache) continue;
		for (const link of cache.links ?? []) {
			const resolved = resolveTarget(link.link, file.path);
			if (resolved) addReference(resolved, file.path, "note-link");
		}
		for (const embed of cache.embeds ?? []) {
			const resolved = resolveTarget(embed.link, file.path);
			if (resolved) addReference(resolved, file.path, "embed");
		}
		for (const link of cache.frontmatterLinks ?? []) {
			const resolved = resolveTarget(link.link, file.path);
			if (resolved) addReference(resolved, file.path, "frontmatter");
		}
	}

	for (const file of ctx.allFiles) {
		if (file.extension !== "canvas") continue;
		canvasFiles.push(file.path);

		let content: string;
		try {
			content = await ctx.vault.cachedRead(file);
		} catch (error) {
			coverageFailures.push({
				path: file.path,
				reason: "read-failed",
				detail: error instanceof Error ? error.message : String(error),
			});
			continue;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(content);
		} catch (error) {
			coverageFailures.push({
				path: file.path,
				reason: "malformed-json",
				detail: error instanceof Error ? error.message : String(error),
			});
			continue;
		}

		const nodes = isCanvasDocument(parsed) ? parsed.nodes : null;
		if (nodes === null) {
			coverageFailures.push({ path: file.path, reason: "unexpected-shape" });
			continue;
		}
		for (const node of nodes) {
			const canvasNode = node as CanvasNode | null;
			if (
				canvasNode === null ||
				canvasNode.type !== "file" ||
				typeof canvasNode.file !== "string" ||
				canvasNode.file === ""
			) {
				continue;
			}
			const resolved = resolveTarget(canvasNode.file, file.path);
			if (resolved) addReference(resolved, file.path, "canvas");
		}
	}

	for (const entry of inboundByPath.values()) {
		entry.kinds.sort();
		entry.sources.sort();
	}

	return {
		inboundByPath,
		canvasFiles,
		coverageFailures,
		coverageComplete: coverageFailures.length === 0,
	};
}

type CanvasDocument = {
	nodes: unknown[];
};

function isCanvasDocument(value: unknown): value is CanvasDocument {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as CanvasDocument).nodes)
	);
}
```

- [ ] **Step 4: Run the module tests**

```bash
npm test -- src/tests/reference-index.test.ts
```

Expected: PASS. Reconcile the fixture photo.jpg expectation per the note in Step 1 if needed (read the fixture files; never weaken assertions).

---

### Task 3: Wire into ScanContext and ScanRunner

**Files:**
- Modify: `src/scanner/ScanContext.ts`
- Modify: `src/scanner/ScanRunner.ts`
- Modify: `src/tests/helpers/scan-context.ts`
- Modify: `src/tests/scan-runner.test.ts`

- [ ] **Step 1: Write the failing runner test**

Append to `src/tests/scan-runner.test.ts` (imports at top: `import { makeEmptyReferenceIndex } from "../scanner/reference-index";` — adjust if style differs):

```typescript
describe("ScanRunner shared reference index", () => {
	it("builds the index once and passes it to scanner contexts", async () => {
		const observed: unknown[] = [];
		const runner = new ScanRunner();
		runner.register({
			id: "broken-links",
			scan: (ctx: ScanContext) => {
				observed.push(ctx.referenceIndex);
				return [];
			},
		});
		runner.register({
			id: "orphan-attachments",
			scan: (ctx: ScanContext) => {
				observed.push(ctx.referenceIndex);
				return [];
			},
		});
		const settings = structuredClone(DEFAULT_SETTINGS);
		settings.enabledScanners = {
			...settings.enabledScanners,
			"broken-links": true,
			"orphan-attachments": true,
		};

		await runner.run(makeApp(), settings);

		expect(observed).toHaveLength(2);
		expect(observed[0]).toBe(observed[1]); // same instance, built once
		expect(observed[0]).not.toEqual(makeEmptyReferenceIndex()); // a real build, not the empty default
	});
});
```

(`makeApp` and `DEFAULT_SETTINGS` are already used in that file; reuse them. The `not.toEqual(empty)` line is a sanity check that a build actually ran — with an empty vault the real index is still a distinct built object; if `toEqual` semantics make this flaky, replace with an instance-of `ReferenceIndex` structural check on `inboundByPath` being a Map.)

- [ ] **Step 2: Run and confirm it fails**

```bash
npm test -- src/tests/scan-runner.test.ts
```

Expected: FAIL — `referenceIndex` missing on scanner context (or type error).

- [ ] **Step 3: Wire the type and the builder**

`src/scanner/ScanContext.ts` — add one import and one field:

```typescript
import type { ReferenceIndex } from "./reference-index";

// ...existing fields...
	emptyNoteWordThreshold: number;
	referenceIndex: ReferenceIndex;
};
```

`src/scanner/ScanRunner.ts` — add the import:

```typescript
import { buildReferenceIndex } from "./reference-index";
```

In `run()`, after the `const ctx: ScanContext = { ... }` literal and before the scanner loop, add:

```typescript
		const referenceIndex = await buildReferenceIndex(ctx);
		ctx.referenceIndex = referenceIndex;
```

`src/tests/helpers/scan-context.ts` — add the import and one field in the returned object:

```typescript
import { makeEmptyReferenceIndex } from "../../scanner/reference-index";
// ...
		emptyNoteWordThreshold: 5,
		referenceIndex: makeEmptyReferenceIndex(),
```

- [ ] **Step 4: Run the runner and module tests, then the precision suite**

```bash
npm test -- src/tests/scan-runner.test.ts src/tests/reference-index.test.ts src/tests/scanner-precision.test.ts
```

Expected: all green; the precision inventory unchanged (no scanner consumes the index yet).

---

### Task 4: Verification, benchmark gate, commit, PR

**Files:** none new (verification only)

- [ ] **Step 1: Full gates**

```bash
npm run lint && npm run lint:obsidian-warnings && npm run build && npm test
```

Expected: all exit 0.

- [ ] **Step 2: Benchmark within 15% of baseline**

```bash
npm run benchmark:scan
```

Expected: file/issue counts unchanged (`552 files | 246 issues`); median scan ≤ 68ms (15% over the 59ms baseline). If it exceeds, investigate the index build cost before proceeding — do not rationalize a larger bound without evidence.

- [ ] **Step 3: Confirm scanner files untouched**

```bash
git diff --stat main -- src/scanner/scanners src/report src/fix src/settings src/main.ts src/utils cli
```

Expected: empty.

- [ ] **Step 4: Commit and push**

```bash
git add src/scanner/reference-index.ts src/scanner/ScanContext.ts src/scanner/ScanRunner.ts src/tests/reference-index.test.ts src/tests/scan-runner.test.ts src/tests/helpers/scan-context.ts src/tests/helpers/fixture-vault.ts
git commit -m "feat: add shared reference index"
git push -u origin feat/reference-index
```

- [ ] **Step 5: Open the PR** against `main`, titled `feat: add shared reference index`, including: product behavior changed (none — index built but unconsumed); non-goals (no scanner changes, no Canvas orphan fix yet); focused tests run; full verification incl. the benchmark comparison numbers; compatibility (none — no output changes); manual validation (precision inventory byte-identical); remaining boundaries (CSS/Dataview/publishing named, coverage-gate semantics documented).

## Self-review checklist (completed during plan writing)

- Roadmap Task 1.1 requirements: resolve md/wiki/embed/frontmatter ✓ (Task 2 builder); Canvas file nodes ✓; inbound count + source kinds ✓; coverage failures without failing scan ✓; exposes enough for orphan/duplicate/impact ✓ (query API + sources); ScanRunner builds once and passes via ScanContext ✓ (Task 3); malformed Canvas → structured failure ✓; CLI/plugin same semantics ✓ (shared resolver, no adapter change needed — deviation documented); CSS/Dataview/publishing named boundaries ✓ (module doc comment + design); no vault mutation ✓ (test pins zero reads).
- Verification matrix from the roadmap: focused tests + `npm run benchmark:scan` ✓ (Task 4); precision suite as the no-regression net ✓.
- Type consistency: `ReferenceIndex`/`InboundReference`/`ReferenceCoverageFailure`/`makeEmptyReferenceIndex`/`buildReferenceIndex`/`getInboundReference`/`isReferenced` defined in Task 2 and used unchanged in Tasks 1/3 and the test files.
