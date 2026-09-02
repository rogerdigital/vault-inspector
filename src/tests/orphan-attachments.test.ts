import { describe, it, expect } from "vitest";
import { orphanAttachmentsScanner } from "../scanner/scanners/orphan-attachments";
import type { ScanContext } from "../scanner/ScanContext";
import type {
	ReferenceCoverageFailure,
	ReferenceIndex,
	ReferenceSourceKind,
} from "../scanner/reference-index";
import { makeEmptyReferenceIndex } from "../scanner/reference-index";

function makeFile(path: string, mtime = 1000, size = 1024) {
	return { path, stat: { size, mtime } } as any;
}

function makeCtx(overrides: Partial<ScanContext> = {}): ScanContext {
	return {
		app: {} as any,
		metadataCache: {} as any,
		vault: {} as any,
		markdownFiles: [],
		allFiles: [],
		filePathIndex: new Set(),
		enabledScanners: new Set(["orphan-attachments"]),
		ignoredFingerprints: new Set(),
		largeMarkdownBytes: 100 * 1024,
		largeAttachmentBytes: 5 * 1024 * 1024,
		duplicateHashMaxBytes: 1024 * 1024,
		lowUsageTagThreshold: 2,
		watchedTags: [],
		ignoredFolders: [],
		referenceIndex: makeEmptyReferenceIndex(),
		...overrides,
	} as ScanContext;
}

function makeIndex(
	referenced: Record<string, { count?: number; kinds?: ReferenceSourceKind[]; sources?: string[] }>,
	coverageFailures: ReferenceCoverageFailure[] = [],
): ReferenceIndex {
	const inboundByPath = new Map(
		Object.entries(referenced).map(([path, entry]) => [
			path,
			{
				count: entry.count ?? 1,
				kinds: entry.kinds ?? ["note-link"],
				sources: entry.sources ?? ["notes/a.md"],
			},
		]),
	);
	return {
		inboundByPath,
		canvasFiles: [],
		coverageFailures,
		coverageComplete: coverageFailures.length === 0,
	};
}

const OLD_MTIME = Date.now() - 30 * 24 * 60 * 60 * 1000;

describe("orphanAttachmentsScanner", () => {
	it("detects attachments with no inbound references as candidates with rich evidence", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME, 4096);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["assets/orphan.png"]),
			referenceIndex: makeIndex({}),
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0]).toMatchObject({
			primaryPath: "assets/orphan.png",
			severity: "warning",
			classification: "candidate",
			evidence: {
				size: 4096,
				lastModified: OLD_MTIME,
				referenceCount: 0,
				coverageComplete: true,
			},
			explanation: {
				why: "No note, embed, frontmatter link, or Canvas file node in the vault references this attachment.",
				caveat: "CSS, Dataview, publishing pipelines, and external tools can reference files outside this scan boundary.",
				nextStep: "Review external and generated references before moving the file to trash.",
			},
			fixAction: {
				kind: "trash-file",
				targetPaths: ["assets/orphan.png"],
			},
		});
	});

	it.each([
		["note-link", ["notes/a.md"]],
		["embed", ["notes/a.md"]],
		["frontmatter", ["notes/a.md"]],
		["canvas", ["canvas/board.canvas"]],
	] as const)("does not report attachments referenced via %s through the index", async (kind, sources) => {
		const img = makeFile("assets/used.png", OLD_MTIME);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["assets/used.png"]),
			referenceIndex: makeIndex({
				"assets/used.png": { count: 1, kinds: [kind as ReferenceSourceKind], sources: [...sources] },
			}),
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("downgrades recently modified orphans to info", async () => {
		const img = makeFile("assets/recent.png", Date.now() - 1000);
		const ctx = makeCtx({ allFiles: [img], filePathIndex: new Set(["assets/recent.png"]) });
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("info");
	});

	it("uses warning severity for old orphans", async () => {
		const img = makeFile("assets/old.png", OLD_MTIME);
		const ctx = makeCtx({ allFiles: [img], filePathIndex: new Set(["assets/old.png"]) });
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues[0].severity).toBe("warning");
	});

	it("skips non-attachment files", async () => {
		const md = makeFile("notes/a.md", OLD_MTIME, 100);
		const ctx = makeCtx({ allFiles: [md], filePathIndex: new Set(["notes/a.md"]) });
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("skips files in ignored folders", async () => {
		const img = makeFile("templates/bg.png", OLD_MTIME);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["templates/bg.png"]),
			ignoredFolders: ["templates"],
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(0);
	});

	it("omits the delete fix action while reference coverage is incomplete", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["assets/orphan.png"]),
			referenceIndex: makeIndex({}, [{ path: "canvas/bad.canvas", reason: "malformed-json" }]),
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		const orphan = issues.find((issue) => issue.title === "Orphan attachment");
		expect(orphan).toBeDefined();
		expect(orphan?.fixAction).toBeUndefined();
		expect(orphan?.evidence.coverageComplete).toBe(false);
		expect(orphan?.classification).toBe("candidate");
		expect(orphan?.explanation.nextStep).toBe(
			"Resolve the incomplete reference coverage below before moving the file to trash.",
		);
	});

	it("blocks deletion when a Markdown reference source was not indexed", async () => {
		const img = makeFile("assets/maybe-used.png", OLD_MTIME);
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set([img.path]),
			referenceIndex: makeIndex({}, [
				{ path: "notes/uncached.md", reason: "metadata-cache-missing" },
			]),
		});

		const issues = await orphanAttachmentsScanner.scan(ctx);
		const orphan = issues.find((issue) => issue.title === "Orphan attachment");
		const coverage = issues.find(
			(issue) => issue.title === "Reference coverage incomplete",
		);

		expect(orphan?.fixAction).toBeUndefined();
		expect(orphan?.evidence.coverageComplete).toBe(false);
		expect(coverage).toMatchObject({
			classification: "unverified",
			primaryPath: "notes/uncached.md",
			evidence: { reasons: "metadata-cache-missing" },
		});
		expect(coverage?.message).toContain("reference source");
		expect(coverage?.explanation.why).toContain("Markdown metadata");
	});

	it("emits exactly one unverified coverage finding summarizing all failures", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME);
		const failures: ReferenceCoverageFailure[] = [
			{ path: "canvas/z-bad.canvas", reason: "unexpected-shape" },
			{ path: "canvas/a-bad.canvas", reason: "malformed-json", detail: "boom" },
		];
		const ctx = makeCtx({
			allFiles: [img],
			filePathIndex: new Set(["assets/orphan.png"]),
			referenceIndex: makeIndex({}, failures),
		});
		const issues = await orphanAttachmentsScanner.scan(ctx);
		const coverage = issues.filter((issue) => issue.title === "Reference coverage incomplete");
		expect(coverage).toHaveLength(1);
		expect(coverage[0]).toMatchObject({
			scannerId: "orphan-attachments",
			severity: "info",
			classification: "unverified",
			primaryPath: "canvas/a-bad.canvas",
			relatedPaths: ["canvas/a-bad.canvas", "canvas/z-bad.canvas"],
			evidence: {
				failedCount: 2,
				failedPaths: "canvas/a-bad.canvas,canvas/z-bad.canvas",
				reasons: "malformed-json,unexpected-shape",
			},
		});
		expect(coverage[0].fixAction).toBeUndefined();
		expect(coverage[0].explanation.why).toContain("Markdown metadata or Canvas reference sources");
	});

	it("fingerprints the coverage finding deterministically per failure set", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME);
		const run = (failures: ReferenceCoverageFailure[]) =>
			makeCtx({
				allFiles: [img],
				filePathIndex: new Set(["assets/orphan.png"]),
				referenceIndex: makeIndex({}, failures),
			});
		const first = await orphanAttachmentsScanner.scan(
			run([{ path: "canvas/bad.canvas", reason: "malformed-json" }]),
		);
		const second = await orphanAttachmentsScanner.scan(
			run([{ path: "canvas/bad.canvas", reason: "malformed-json" }]),
		);
		const other = await orphanAttachmentsScanner.scan(
			run([{ path: "canvas/other.canvas", reason: "read-failed" }]),
		);
		const fingerprintOf = (ctxIssues: Awaited<ReturnType<typeof orphanAttachmentsScanner.scan>>) =>
			ctxIssues.find((issue) => issue.title === "Reference coverage incomplete")?.fingerprint;
		expect(fingerprintOf(second)).toBe(fingerprintOf(first));
		expect(fingerprintOf(other)).not.toBe(fingerprintOf(first));
	});

	it("emits no coverage finding when coverage is complete", async () => {
		const img = makeFile("assets/orphan.png", OLD_MTIME);
		const ctx = makeCtx({ allFiles: [img], filePathIndex: new Set(["assets/orphan.png"]) });
		const issues = await orphanAttachmentsScanner.scan(ctx);
		expect(issues).toHaveLength(1);
		expect(issues.some((issue) => issue.title === "Reference coverage incomplete")).toBe(false);
	});
});
